// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {PasskeyValidator} from "src/modules/passkey/PasskeyValidator.sol";

/// @notice Stateful fuzz handler for PasskeyValidator.
/// @dev The handler itself is the smart account: the validator keys all state by
///      msg.sender, so every call made from here mutates `address(this)`'s passkeys.
///      Ghost state mirrors what the validator *should* hold so the invariant test
///      can compare the two after every call.
contract PasskeyValidatorHandler is Test {
    PasskeyValidator public immutable validator;

    // Small id pool so actions collide with existing keys often enough to exercise
    // duplicate-add, re-add-after-removal and schedule/cancel/execute on live ids.
    uint256 internal constant ID_POOL_SIZE = 8;
    bytes32[ID_POOL_SIZE] internal idPool;

    // Ghost model of the account's passkey set.
    bytes32[] internal ghostIds;
    mapping(bytes32 => bool) public ghostHasPasskey;

    // Ghost model of each id's pending removal.
    mapping(bytes32 => uint256) public ghostScheduledAt;
    mapping(bytes32 => uint256) public ghostExecuteAfter;
    mapping(bytes32 => bool) public ghostCancelled;

    // A successful removal that the ghost model says was not allowed
    // (never scheduled, cancelled, or still inside PASSKEY_REMOVAL_DELAY).
    uint256 public illegalRemovals;
    // A successful add of an id the ghost model says is already registered.
    uint256 public duplicateAdds;

    // block.timestamp tracked explicitly so warps survive between handler calls.
    uint256 public currentTimestamp;

    // Call summary, used to confirm the run actually exercised each path.
    mapping(bytes32 => uint256) public calls;
    mapping(bytes32 => uint256) public successes;

    modifier useCurrentTime() {
        vm.warp(currentTimestamp);
        _;
    }

    constructor(PasskeyValidator _validator) {
        validator = _validator;
        for (uint256 i = 0; i < ID_POOL_SIZE; i++) {
            idPool[i] = keccak256(abi.encode("passkey-invariant-id", i));
        }
        currentTimestamp = block.timestamp;

        // Install with the first pool id so the account starts with exactly one passkey.
        bytes32 firstId = idPool[0];
        validator.onInstall(abi.encode(firstId, _px(firstId), _py(firstId)));
        _ghostAdd(firstId);
    }

    /*//////////////////////////////////////////////////////////////
                                ACTIONS
    //////////////////////////////////////////////////////////////*/

    function addPasskey(uint256 idSeed) external useCurrentTime {
        calls["addPasskey"]++;
        bytes32 id = idPool[bound(idSeed, 0, ID_POOL_SIZE - 1)];

        try validator.addPasskey(id, _px(id), _py(id)) {
            successes["addPasskey"]++;
            if (ghostHasPasskey[id]) {
                duplicateAdds++;
                return;
            }
            _ghostAdd(id);
        } catch {}
    }

    function scheduleRemovePasskey(uint256 idSeed) external useCurrentTime {
        calls["scheduleRemovePasskey"]++;
        bytes32 id = _pickId(idSeed);

        try validator.scheduleRemovePasskey(id) {
            successes["scheduleRemovePasskey"]++;
            ghostScheduledAt[id] = block.timestamp;
            ghostExecuteAfter[id] = block.timestamp + validator.PASSKEY_REMOVAL_DELAY();
            ghostCancelled[id] = false;
        } catch {}
    }

    function cancelRemovePasskey(uint256 idSeed) external useCurrentTime {
        calls["cancelRemovePasskey"]++;
        bytes32 id = _pickId(idSeed);

        try validator.cancelRemovePasskey(id) {
            successes["cancelRemovePasskey"]++;
            ghostCancelled[id] = true;
        } catch {}
    }

    /// @param useAlias exercise the legacy `removePasskey` entry point instead.
    function executeRemovePasskey(uint256 idSeed, bool useAlias) external useCurrentTime {
        calls["executeRemovePasskey"]++;
        bytes32 id = _pickId(idSeed);

        bool removed;
        if (useAlias) {
            try validator.removePasskey(id) {
                removed = true;
            } catch {}
        } else {
            try validator.executeRemovePasskey(id) {
                removed = true;
            } catch {}
        }
        if (!removed) return;

        successes["executeRemovePasskey"]++;
        bool allowed = ghostScheduledAt[id] != 0 && !ghostCancelled[id] && block.timestamp >= ghostExecuteAfter[id];
        if (!allowed) {
            illegalRemovals++;
        }
        _ghostRemove(id);
    }

    function warp(uint256 secondsForward) external {
        calls["warp"]++;
        currentTimestamp += bound(secondsForward, 0, 3 days);
        vm.warp(currentTimestamp);
    }

    /*//////////////////////////////////////////////////////////////
                                 VIEWS
    //////////////////////////////////////////////////////////////*/

    function ghostPasskeyCount() external view returns (uint256) {
        return ghostIds.length;
    }

    function ghostPasskeyAt(uint256 i) external view returns (bytes32) {
        return ghostIds[i];
    }

    /*//////////////////////////////////////////////////////////////
                                INTERNAL
    //////////////////////////////////////////////////////////////*/

    /// @dev Mostly target live ids (so schedule/cancel/execute can succeed), sometimes
    ///      any pool id (so the "unknown id" revert paths are covered too).
    function _pickId(uint256 seed) internal view returns (bytes32) {
        if (ghostIds.length > 0 && seed % 4 != 0) {
            return ghostIds[(seed >> 2) % ghostIds.length];
        }
        return idPool[(seed >> 2) % ID_POOL_SIZE];
    }

    function _ghostAdd(bytes32 id) internal {
        ghostHasPasskey[id] = true;
        ghostIds.push(id);
    }

    function _ghostRemove(bytes32 id) internal {
        ghostHasPasskey[id] = false;
        delete ghostScheduledAt[id];
        delete ghostExecuteAfter[id];
        delete ghostCancelled[id];
        for (uint256 i = 0; i < ghostIds.length; i++) {
            if (ghostIds[i] == id) {
                ghostIds[i] = ghostIds[ghostIds.length - 1];
                ghostIds.pop();
                return;
            }
        }
    }

    function _px(bytes32 id) internal pure returns (uint256) {
        return uint256(keccak256(abi.encode(id, "px")));
    }

    function _py(bytes32 id) internal pure returns (uint256) {
        return uint256(keccak256(abi.encode(id, "py")));
    }
}
