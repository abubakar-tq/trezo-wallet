// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {SocialRecovery} from "src/modules/SocialRecovery/SocialRecovery.sol";
import {ISocialRecovery} from "src/modules/SocialRecovery/interfaces/ISocialRecovery.sol";
import {PasskeyTypes} from "src/common/Types.sol";
import {RecoveryTypes} from "src/recovery/RecoveryTypes.sol";
import {MockRecoveryWallet} from "test/invariant/handlers/SocialRecoveryHandler.sol";

/// @notice Mutating any single ChainRecoveryScope field after the guardians signed
///         must make scheduleRecovery revert.
contract SocialRecoveryScopeFuzzTest is Test {
    bytes32 private constant PASSKEY_TYPE_HASH = keccak256("PasskeyInit(bytes32 idRaw,uint256 px,uint256 py)");
    uint256 internal constant GUARDIANS = 5;
    uint256 internal constant THRESHOLD = 3;

    SocialRecovery internal module;
    MockRecoveryWallet internal wallet;
    uint256[] internal guardianKeys;

    function setUp() public {
        module = new SocialRecovery();
        wallet = new MockRecoveryWallet(address(module));

        address[] memory guardians = new address[](GUARDIANS);
        for (uint256 i = 0; i < GUARDIANS; i++) {
            guardianKeys.push(uint256(keccak256(abi.encode("scope-fuzz-guardian", i))));
            guardians[i] = vm.addr(guardianKeys[i]);
        }
        vm.prank(address(wallet));
        module.onInstall(abi.encode(guardians, THRESHOLD, uint256(1 hours)));
    }

    /// @param field 0 chainId, 1 wallet, 2 socialRecovery, 3 nonce, 4 guardianSetHash, 5 policyHash
    /// @param mode  0: intent + sigs exactly as signed
    ///              1: attacker recomputes intent.chainScopeHash, keeps the stale sigs
    ///              2: attacker recomputes chainScopeHash and guardians sign the tampered scope
    function testFuzz_mutatingAnyScopeFieldReverts(uint8 field, uint256 delta, uint8 mode) public {
        field = uint8(bound(field, 0, 5));
        mode = uint8(bound(mode, 0, 2));
        // Non-zero XOR mask, so the field always actually changes.
        uint256 mask = bound(delta, 1, type(uint160).max);

        PasskeyTypes.PasskeyInit memory passkey = PasskeyTypes.PasskeyInit({
            idRaw: keccak256(abi.encode("scope-fuzz-passkey", delta)),
            px: uint256(keccak256(abi.encode("px", delta))),
            py: uint256(keccak256(abi.encode("py", delta)))
        });
        RecoveryTypes.ChainRecoveryScope[] memory scopes = _scopes();
        RecoveryTypes.RecoveryIntent memory intent = _intent(passkey, scopes);
        ISocialRecovery.GuardianSig[] memory sigs = _signAll(module.getRecoveryDigest(intent));

        RecoveryTypes.ChainRecoveryScope[] memory tampered = _scopes();
        _mutate(tampered[0], field, mask);

        RecoveryTypes.RecoveryIntent memory tamperedIntent = intent;
        ISocialRecovery.GuardianSig[] memory tamperedSigs = sigs;
        if (mode >= 1) {
            tamperedIntent = _intent(passkey, tampered);
        }
        if (mode == 2) {
            tamperedSigs = _signAll(module.getRecoveryDigest(tamperedIntent));
        }

        vm.expectRevert();
        module.scheduleRecovery(address(wallet), passkey, tamperedIntent, tampered, tamperedSigs);

        // Control: the untampered submission is accepted, so the revert came from the mutation.
        module.scheduleRecovery(address(wallet), passkey, intent, scopes, sigs);
        assertEq(module.getRecoveryNonce(address(wallet)), 1, "untampered schedule should succeed");
    }

    function _mutate(RecoveryTypes.ChainRecoveryScope memory scope, uint8 field, uint256 mask) internal pure {
        if (field == 0) scope.chainId ^= mask;
        else if (field == 1) scope.wallet = address(uint160(scope.wallet) ^ uint160(mask));
        else if (field == 2) scope.socialRecovery = address(uint160(scope.socialRecovery) ^ uint160(mask));
        else if (field == 3) scope.nonce ^= mask;
        else if (field == 4) scope.guardianSetHash ^= bytes32(mask);
        else scope.policyHash ^= bytes32(mask);
    }

    function _scopes() internal view returns (RecoveryTypes.ChainRecoveryScope[] memory scopes) {
        scopes = new RecoveryTypes.ChainRecoveryScope[](1);
        scopes[0] = RecoveryTypes.ChainRecoveryScope({
            chainId: block.chainid,
            wallet: address(wallet),
            socialRecovery: address(module),
            nonce: module.getRecoveryNonce(address(wallet)),
            guardianSetHash: module.getGuardianSetHash(address(wallet)),
            policyHash: module.getPolicyHash(address(wallet))
        });
    }

    function _intent(PasskeyTypes.PasskeyInit memory passkey, RecoveryTypes.ChainRecoveryScope[] memory scopes)
        internal
        view
        returns (RecoveryTypes.RecoveryIntent memory)
    {
        return RecoveryTypes.RecoveryIntent({
            requestId: keccak256(abi.encode(address(wallet), scopes[0].nonce, passkey.idRaw)),
            newPasskeyHash: keccak256(abi.encode(PASSKEY_TYPE_HASH, passkey.idRaw, passkey.px, passkey.py)),
            chainScopeHash: module.getChainScopeHash(scopes),
            validAfter: 0,
            deadline: type(uint48).max,
            metadataHash: bytes32(0)
        });
    }

    function _signAll(bytes32 digest) internal view returns (ISocialRecovery.GuardianSig[] memory sigs) {
        sigs = new ISocialRecovery.GuardianSig[](GUARDIANS);
        for (uint256 i = 0; i < GUARDIANS; i++) {
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(guardianKeys[i], digest);
            sigs[i] = ISocialRecovery.GuardianSig({
                index: uint16(i),
                kind: ISocialRecovery.SigKind.EOA_ECDSA,
                sig: abi.encodePacked(r, s, v)
            });
        }
    }
}
