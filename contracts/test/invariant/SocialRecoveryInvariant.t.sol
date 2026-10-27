// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {SocialRecovery} from "src/modules/SocialRecovery/SocialRecovery.sol";
import {PasskeyTypes} from "src/common/Types.sol";
import {SocialRecoveryHandler, MockRecoveryWallet} from "test/invariant/handlers/SocialRecoveryHandler.sol";

contract SocialRecoveryInvariantTest is Test {
    uint256 internal constant INITIAL_GUARDIANS = 5;
    uint256 internal constant POOL_SIZE = 7;
    uint256 internal constant THRESHOLD = 3;
    uint256 internal constant TIMELOCK = 1 hours;

    SocialRecovery internal module;
    MockRecoveryWallet internal wallet;
    SocialRecoveryHandler internal handler;

    function setUp() public {
        module = new SocialRecovery();
        wallet = new MockRecoveryWallet(address(module));

        // 5 active guardians plus 2 spare keys that changeGuardians can rotate in.
        uint256[] memory keyPool = new uint256[](POOL_SIZE);
        address[] memory guardians = new address[](INITIAL_GUARDIANS);
        for (uint256 i = 0; i < POOL_SIZE; i++) {
            keyPool[i] = uint256(keccak256(abi.encode("social-recovery-guardian", i)));
            if (i < INITIAL_GUARDIANS) guardians[i] = vm.addr(keyPool[i]);
        }

        vm.prank(address(wallet));
        module.onInstall(abi.encode(guardians, THRESHOLD, TIMELOCK));

        handler = new SocialRecoveryHandler(module, wallet, keyPool, TIMELOCK);

        bytes4[] memory selectors = new bytes4[](8);
        selectors[0] = SocialRecoveryHandler.schedule.selector;
        selectors[1] = SocialRecoveryHandler.replayOld.selector;
        selectors[2] = SocialRecoveryHandler.tamperScope.selector;
        selectors[3] = SocialRecoveryHandler.cancel.selector;
        selectors[4] = SocialRecoveryHandler.execute.selector;
        selectors[5] = SocialRecoveryHandler.warp.selector;
        selectors[6] = SocialRecoveryHandler.changeGuardians.selector;
        selectors[7] = SocialRecoveryHandler.unauthorizedGuardianChange.selector;

        targetContract(address(handler));
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    /// The nonce advances exactly once per accepted schedule and never decreases.
    function invariant_nonceTracksSchedules() public view {
        assertEq(module.getRecoveryNonce(address(wallet)), handler.ghostSchedules(), "nonce != accepted schedules");
    }

    function invariant_thresholdWithinGuardianCount() public view {
        (address[] memory guardians, uint256 threshold) = module.getRecoveryDetails(address(wallet));
        assertGe(threshold, 1, "threshold dropped to zero");
        assertLe(threshold, guardians.length, "threshold exceeds guardian count");
    }

    function invariant_noExecutionBeforeExecuteAfter() public view {
        assertEq(handler.earlyExecutions(), 0, "recovery executed inside its timelock");
        uint256 n = handler.executionCount();
        for (uint256 i = 0; i < n; i++) {
            SocialRecoveryHandler.ExecutionRecord memory rec = handler.executionAt(i);
            assertGt(rec.executeAfter, 0, "executed without a scheduled executeAfter");
            assertGe(rec.executedAt, rec.executeAfter, "recovery executed inside its timelock");
        }
    }

    /// Every passkey the wallet received was scheduled with >= threshold distinct valid guardian sigs.
    function invariant_receivedPasskeysWereApproved() public view {
        assertEq(handler.underThresholdSchedules(), 0, "schedule accepted with fewer than threshold valid sigs");
        uint256 n = wallet.receivedCount();
        assertEq(n, handler.ghostExecutions(), "wallet received passkeys outside executeRecovery");
        for (uint256 i = 0; i < n; i++) {
            PasskeyTypes.PasskeyInit memory pk = wallet.receivedAt(i);
            assertTrue(handler.ghostPasskeyApproved(handler.hashPasskey(pk)), "wallet received an unapproved passkey");
        }
    }

    function invariant_replayNeverSucceeds() public view {
        assertEq(handler.replaySuccesses(), 0, "replayed intent + sigs was accepted");
    }

    function invariant_tamperedScopeNeverSucceeds() public view {
        assertEq(handler.tamperSuccesses(), 0, "tampered chain scope was accepted");
    }

    function invariant_unauthorizedChangesNeverSucceed() public view {
        assertEq(handler.unauthorizedSuccesses(), 0, "non-wallet caller changed recovery config");
    }

    /// One slot per wallet: no schedule lands on top of a live recovery, and the slot matches the ghost.
    function invariant_atMostOneActiveRecovery() public view {
        assertEq(handler.doubleActiveSchedules(), 0, "second recovery scheduled while one was active");
        (bytes32 activeId,) = module.getActiveRecovery(address(wallet));
        assertEq(activeId, handler.ghostActiveRecoveryId(), "active recovery diverged from ghost");
    }
}
