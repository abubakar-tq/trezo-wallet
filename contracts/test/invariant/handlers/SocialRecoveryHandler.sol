// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {SocialRecovery, ISocialRecoveryAccount} from "src/modules/SocialRecovery/SocialRecovery.sol";
import {ISocialRecovery} from "src/modules/SocialRecovery/interfaces/ISocialRecovery.sol";
import {PasskeyTypes} from "src/common/Types.sol";
import {RecoveryTypes} from "src/recovery/RecoveryTypes.sol";

/// @notice Minimal wallet: authorizes one recovery module and records every passkey it is handed.
contract MockRecoveryWallet is ISocialRecoveryAccount {
    address public immutable module;
    PasskeyTypes.PasskeyInit[] internal _received;

    constructor(address _module) {
        module = _module;
    }

    function isRecoveryModule(address m) external view override returns (bool) {
        return m == module;
    }

    function addPasskeyFromRecovery(PasskeyTypes.PasskeyInit calldata newPassKey) external override {
        require(msg.sender == module, "only module");
        _received.push(newPassKey);
    }

    function receivedCount() external view returns (uint256) {
        return _received.length;
    }

    function receivedAt(uint256 i) external view returns (PasskeyTypes.PasskeyInit memory) {
        return _received[i];
    }
}

/// @notice Stateful fuzz handler for SocialRecovery.
/// @dev Every action wraps the module call in try/catch so the fuzzer can explore
///      revert paths without failing the run. Ghost counters record anything that
///      succeeded but should not have; the invariant test asserts they stay zero.
contract SocialRecoveryHandler is Test {
    struct Submission {
        PasskeyTypes.PasskeyInit passkey;
        RecoveryTypes.RecoveryIntent intent;
        RecoveryTypes.ChainRecoveryScope[] scopes;
        ISocialRecovery.GuardianSig[] sigs;
    }

    struct ExecutionRecord {
        uint256 executedAt;
        uint256 executeAfter;
    }

    bytes32 private constant PASSKEY_TYPE_HASH = keccak256("PasskeyInit(bytes32 idRaw,uint256 px,uint256 py)");

    SocialRecovery public immutable module;
    MockRecoveryWallet public immutable wallet;
    uint256 public immutable timelock;

    // Guardian key pool. The first `initialGuardians` keys start active;
    // changeGuardians can rotate the rest in and out.
    uint256[] internal guardianKeyPool;
    mapping(address => uint256) internal keyOf;
    // Never a guardian. Used to forge signatures.
    uint256 internal constant OUTSIDER_KEY = 0xBAD0BAD0;

    // Ghost state.
    uint256 public ghostSchedules;
    uint256 public ghostExecutions;
    uint256 public ghostCancels;
    uint256 public ghostGuardianChanges;
    uint256 public ghostApprovedPasskeys;
    mapping(bytes32 => bool) public ghostPasskeyApproved;
    bytes32 public ghostActiveRecoveryId;
    ExecutionRecord[] internal executions;

    // Violations: must stay zero.
    uint256 public earlyExecutions;
    uint256 public underThresholdSchedules;
    uint256 public doubleActiveSchedules;
    uint256 public replaySuccesses;
    uint256 public tamperSuccesses;
    uint256 public unauthorizedSuccesses;

    // Every submission that scheduleRecovery accepted, for replay.
    bytes[] internal usedSubmissions;
    uint256 internal passkeyCounter;
    uint256 public currentTimestamp;

    modifier useCurrentTime() {
        vm.warp(currentTimestamp);
        _;
    }

    constructor(SocialRecovery _module, MockRecoveryWallet _wallet, uint256[] memory keyPool, uint256 _timelock) {
        module = _module;
        wallet = _wallet;
        timelock = _timelock;
        for (uint256 i = 0; i < keyPool.length; i++) {
            guardianKeyPool.push(keyPool[i]);
            keyOf[vm.addr(keyPool[i])] = keyPool[i];
        }
        currentTimestamp = block.timestamp;
    }

    /*//////////////////////////////////////////////////////////////
                                ACTIONS
    //////////////////////////////////////////////////////////////*/

    /// Schedule against the current nonce with a random signer subset (often below threshold).
    /// @param signerMask bit i set => guardian i signs.
    /// @param forgeSeed  non-zero => one signature is swapped for an outsider's.
    /// @param multiChain include a second, foreign-chain scope after the local one.
    function schedule(uint256 signerMask, uint256 forgeSeed, bool multiChain) external useCurrentTime {
        (address[] memory guardians, uint256 threshold) = module.getRecoveryDetails(address(wallet));
        Submission memory s = _buildSubmission(module.getRecoveryNonce(address(wallet)), multiChain);
        bytes32 digest = module.getRecoveryDigest(s.intent);

        uint256 mask = bound(signerMask, 0, (1 << guardians.length) - 1);
        s.sigs = _signSubset(guardians, mask, digest);
        if (forgeSeed % 4 == 1 && s.sigs.length > 0) {
            // Same guardian index, but signed by a non-guardian key.
            s.sigs[forgeSeed % s.sigs.length].sig = _sign(OUTSIDER_KEY, digest);
        }

        // Count signatures that independently verify, before the module sees them.
        uint256 validDistinct = _countValidDistinct(guardians, digest, s.sigs);
        (bytes32 activeBefore,) = module.getActiveRecovery(address(wallet));

        try module.scheduleRecovery(address(wallet), s.passkey, s.intent, s.scopes, s.sigs) returns (
            bytes32 recoveryId
        ) {
            ghostSchedules++;
            if (activeBefore != bytes32(0)) doubleActiveSchedules++;
            if (validDistinct < threshold) {
                underThresholdSchedules++;
            } else {
                ghostPasskeyApproved[_hashPasskey(s.passkey)] = true;
                ghostApprovedPasskeys++;
            }
            ghostActiveRecoveryId = recoveryId;
            usedSubmissions.push(abi.encode(s));
        } catch {}
    }

    /// Resubmit a previously accepted intent + signatures from a random caller.
    function replayOld(uint256 indexSeed, address caller) external useCurrentTime {
        if (usedSubmissions.length == 0) return;
        Submission memory s = abi.decode(usedSubmissions[indexSeed % usedSubmissions.length], (Submission));

        vm.prank(caller);
        try module.scheduleRecovery(address(wallet), s.passkey, s.intent, s.scopes, s.sigs) {
            replaySuccesses++;
        } catch {}
    }

    /// Build a fully valid submission, then mutate nonce / guardianSetHash / policyHash.
    /// @param mode 0: leave intent + sigs as signed (scope hash no longer matches)
    ///             1: recompute chainScopeHash but keep the stale sigs
    ///             2: recompute chainScopeHash and have every guardian re-sign it
    function tamperScope(uint8 field, uint256 delta, uint8 mode) external useCurrentTime {
        (address[] memory guardians,) = module.getRecoveryDetails(address(wallet));
        Submission memory s = _buildSubmission(module.getRecoveryNonce(address(wallet)), false);
        uint256 allSigners = (1 << guardians.length) - 1;
        s.sigs = _signSubset(guardians, allSigners, module.getRecoveryDigest(s.intent));

        delta = bound(delta, 1, type(uint128).max);
        field = uint8(bound(field, 0, 2));
        if (field == 0) {
            unchecked {
                s.scopes[0].nonce += delta;
            }
        } else if (field == 1) {
            s.scopes[0].guardianSetHash ^= bytes32(delta);
        } else {
            s.scopes[0].policyHash ^= bytes32(delta);
        }

        mode = uint8(bound(mode, 0, 2));
        if (mode >= 1) {
            s.intent.chainScopeHash = module.getChainScopeHash(s.scopes);
        }
        if (mode == 2) {
            s.sigs = _signSubset(guardians, allSigners, module.getRecoveryDigest(s.intent));
        }

        try module.scheduleRecovery(address(wallet), s.passkey, s.intent, s.scopes, s.sigs) {
            tamperSuccesses++;
        } catch {}
    }

    /// Cancel as the wallet, usually with the live recovery id.
    function cancel(bool useWrongId) external useCurrentTime {
        (bytes32 activeId,) = module.getActiveRecovery(address(wallet));
        bytes32 id = useWrongId ? keccak256(abi.encode(activeId)) : activeId;

        vm.prank(address(wallet));
        try module.cancelRecovery(address(wallet), id) {
            ghostCancels++;
            ghostActiveRecoveryId = bytes32(0);
        } catch {}
    }

    /// Execute from any caller.
    function execute(address caller) external useCurrentTime {
        (, uint256 executeAfter) = module.getActiveRecovery(address(wallet));

        vm.prank(caller);
        try module.executeRecovery(address(wallet)) {
            ghostExecutions++;
            executions.push(ExecutionRecord({executedAt: block.timestamp, executeAfter: executeAfter}));
            if (block.timestamp < executeAfter) earlyExecutions++;
            ghostActiveRecoveryId = bytes32(0);
        } catch {}
    }

    function warp(uint256 secondsForward) external {
        currentTimestamp += bound(secondsForward, 0, 2 * timelock);
        vm.warp(currentTimestamp);
    }

    /// Wallet adds an inactive pool guardian or removes an active one, with a valid new threshold.
    function changeGuardians(uint256 seed, bool add, uint256 thresholdSeed) external useCurrentTime {
        (address[] memory guardians,) = module.getRecoveryDetails(address(wallet));
        address[] memory change = new address[](1);
        uint256 newLength;

        if (add) {
            address candidate = _inactivePoolGuardian(guardians, seed);
            if (candidate == address(0)) return;
            change[0] = candidate;
            newLength = guardians.length + 1;
        } else {
            if (guardians.length <= 1) return;
            change[0] = guardians[seed % guardians.length];
            newLength = guardians.length - 1;
        }
        uint256 newThreshold = bound(thresholdSeed, 1, newLength);

        vm.startPrank(address(wallet));
        if (add) {
            try module.addGuardians(address(wallet), change, newThreshold) {
                ghostGuardianChanges++;
            } catch {}
        } else {
            try module.removeGuardians(address(wallet), change, newThreshold) {
                ghostGuardianChanges++;
            } catch {}
        }
        vm.stopPrank();
    }

    /// A non-wallet caller tries add/remove guardians or cancel.
    function unauthorizedGuardianChange(address caller, uint8 action, uint256 thresholdSeed) external useCurrentTime {
        if (caller == address(wallet)) caller = address(uint160(caller) ^ 1);
        (address[] memory guardians,) = module.getRecoveryDetails(address(wallet));
        action = uint8(bound(action, 0, 2));

        vm.startPrank(caller);
        if (action == 0) {
            address[] memory change = new address[](1);
            change[0] = vm.addr(OUTSIDER_KEY);
            try module.addGuardians(address(wallet), change, bound(thresholdSeed, 1, guardians.length + 1)) {
                unauthorizedSuccesses++;
            } catch {}
        } else if (action == 1) {
            if (guardians.length > 1) {
                address[] memory change = new address[](1);
                change[0] = guardians[thresholdSeed % guardians.length];
                try module.removeGuardians(address(wallet), change, 1) {
                    unauthorizedSuccesses++;
                } catch {}
            }
        } else {
            (bytes32 activeId,) = module.getActiveRecovery(address(wallet));
            try module.cancelRecovery(address(wallet), activeId) {
                unauthorizedSuccesses++;
            } catch {}
        }
        vm.stopPrank();
    }

    /*//////////////////////////////////////////////////////////////
                                 VIEWS
    //////////////////////////////////////////////////////////////*/

    function executionCount() external view returns (uint256) {
        return executions.length;
    }

    function executionAt(uint256 i) external view returns (ExecutionRecord memory) {
        return executions[i];
    }

    function hashPasskey(PasskeyTypes.PasskeyInit memory passkey) public pure returns (bytes32) {
        return _hashPasskey(passkey);
    }

    /*//////////////////////////////////////////////////////////////
                                INTERNAL
    //////////////////////////////////////////////////////////////*/

    function _buildSubmission(uint256 nonce, bool multiChain) internal returns (Submission memory s) {
        passkeyCounter++;
        s.passkey = PasskeyTypes.PasskeyInit({
            idRaw: keccak256(abi.encode("recovered-passkey", passkeyCounter)),
            px: uint256(keccak256(abi.encode("px", passkeyCounter))),
            py: uint256(keccak256(abi.encode("py", passkeyCounter)))
        });

        s.scopes = new RecoveryTypes.ChainRecoveryScope[](multiChain ? 2 : 1);
        s.scopes[0] = RecoveryTypes.ChainRecoveryScope({
            chainId: block.chainid,
            wallet: address(wallet),
            socialRecovery: address(module),
            nonce: nonce,
            guardianSetHash: module.getGuardianSetHash(address(wallet)),
            policyHash: module.getPolicyHash(address(wallet))
        });
        if (multiChain) {
            // Scopes must be strictly ascending by chainId; a foreign chain sorts after ours.
            s.scopes[1] = RecoveryTypes.ChainRecoveryScope({
                chainId: block.chainid + 1,
                wallet: address(wallet),
                socialRecovery: address(module),
                nonce: 0,
                guardianSetHash: keccak256("foreign-guardians"),
                policyHash: keccak256("foreign-policy")
            });
        }

        s.intent = RecoveryTypes.RecoveryIntent({
            requestId: keccak256(abi.encode(address(wallet), nonce, s.passkey.idRaw)),
            newPasskeyHash: _hashPasskey(s.passkey),
            chainScopeHash: module.getChainScopeHash(s.scopes),
            validAfter: 0,
            deadline: type(uint48).max,
            metadataHash: bytes32(0)
        });
    }

    function _signSubset(address[] memory guardians, uint256 mask, bytes32 digest)
        internal
        view
        returns (ISocialRecovery.GuardianSig[] memory sigs)
    {
        uint256 n;
        for (uint256 i = 0; i < guardians.length; i++) {
            if (mask & (1 << i) != 0) n++;
        }
        sigs = new ISocialRecovery.GuardianSig[](n);
        uint256 j;
        for (uint256 i = 0; i < guardians.length; i++) {
            if (mask & (1 << i) == 0) continue;
            sigs[j++] = ISocialRecovery.GuardianSig({
                index: uint16(i),
                kind: ISocialRecovery.SigKind.EOA_ECDSA,
                sig: _sign(keyOf[guardians[i]], digest)
            });
        }
    }

    function _countValidDistinct(
        address[] memory guardians,
        bytes32 digest,
        ISocialRecovery.GuardianSig[] memory sigs
    ) internal pure returns (uint256 valid) {
        bool[] memory seen = new bool[](guardians.length);
        for (uint256 i = 0; i < sigs.length; i++) {
            uint256 idx = sigs[i].index;
            if (idx >= guardians.length || seen[idx] || sigs[i].sig.length != 65) continue;
            bytes memory raw = sigs[i].sig;
            bytes32 r;
            bytes32 s;
            uint8 v;
            assembly {
                r := mload(add(raw, 0x20))
                s := mload(add(raw, 0x40))
                v := byte(0, mload(add(raw, 0x60)))
            }
            if (ecrecover(digest, v, r, s) == guardians[idx]) {
                seen[idx] = true;
                valid++;
            }
        }
    }

    function _inactivePoolGuardian(address[] memory guardians, uint256 seed) internal view returns (address) {
        uint256 poolLen = guardianKeyPool.length;
        uint256 start = seed % poolLen;
        for (uint256 k = 0; k < poolLen; k++) {
            address candidate = vm.addr(guardianKeyPool[(start + k) % poolLen]);
            bool active;
            for (uint256 i = 0; i < guardians.length; i++) {
                if (guardians[i] == candidate) {
                    active = true;
                    break;
                }
            }
            if (!active) return candidate;
        }
        return address(0);
    }

    function _sign(uint256 key, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _hashPasskey(PasskeyTypes.PasskeyInit memory passkey) internal pure returns (bytes32) {
        return keccak256(abi.encode(PASSKEY_TYPE_HASH, passkey.idRaw, passkey.px, passkey.py));
    }
}
