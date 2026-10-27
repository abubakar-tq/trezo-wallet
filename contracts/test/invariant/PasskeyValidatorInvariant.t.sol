// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {PasskeyValidator} from "src/modules/passkey/PasskeyValidator.sol";
import {PasskeyValidatorHandler} from "test/invariant/handlers/PasskeyValidatorHandler.sol";

contract PasskeyValidatorInvariantTest is Test {
    PasskeyValidator internal validator;
    PasskeyValidatorHandler internal handler;

    function setUp() public {
        validator = new PasskeyValidator();
        handler = new PasskeyValidatorHandler(validator);

        bytes4[] memory selectors = new bytes4[](5);
        selectors[0] = PasskeyValidatorHandler.addPasskey.selector;
        selectors[1] = PasskeyValidatorHandler.scheduleRemovePasskey.selector;
        selectors[2] = PasskeyValidatorHandler.cancelRemovePasskey.selector;
        selectors[3] = PasskeyValidatorHandler.executeRemovePasskey.selector;
        selectors[4] = PasskeyValidatorHandler.warp.selector;

        targetContract(address(handler));
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    /// The account can never be left without a passkey.
    function invariant_accountAlwaysHasAPasskey() public view {
        assertGe(validator.passkeyCount(address(handler)), 1, "account lost its last passkey");
    }

    /// No passkey is removed before PASSKEY_REMOVAL_DELAY, after a cancel, or without a schedule.
    function invariant_noIllegalRemovals() public view {
        assertEq(handler.illegalRemovals(), 0, "passkey removed outside its timelock window");
    }

    /// The validator's passkey set matches the ghost model exactly.
    function invariant_passkeySetMatchesGhost() public view {
        address account = address(handler);
        uint256 count = validator.passkeyCount(account);
        assertEq(count, handler.ghostPasskeyCount(), "passkey count diverged from ghost");
        assertEq(handler.duplicateAdds(), 0, "duplicate passkey id was accepted");

        for (uint256 i = 0; i < count; i++) {
            bytes32 id = PasskeyValidator.PasskeyId.unwrap(validator.passkeyAt(account, i));
            assertTrue(handler.ghostHasPasskey(id), "validator holds a passkey the ghost does not");
        }
        for (uint256 i = 0; i < count; i++) {
            bytes32 id = handler.ghostPasskeyAt(i);
            assertTrue(
                validator.hasPasskey(account, PasskeyValidator.PasskeyId.wrap(id)),
                "ghost holds a passkey the validator does not"
            );
        }
    }
}
