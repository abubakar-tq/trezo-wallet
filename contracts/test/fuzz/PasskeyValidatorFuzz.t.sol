// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {PackedUserOperation} from "lib/modulekit/src/external/ERC4337.sol";
import {PasskeyValidator} from "src/modules/passkey/PasskeyValidator.sol";
import {WebAuthnHelper} from "src/utils/WebAuthnHelper.sol";
import {PassKeyDemo} from "src/utils/PasskeyCred.sol";
import {P256Signer} from "script/P256Signer.s.sol";

/// @notice Random signatures must never validate, through any of the validator's entry points.
contract PasskeyValidatorFuzzTest is Test {
    uint256 internal constant VALIDATION_SUCCESS = uint256(type(uint48).max) << 160;
    bytes4 internal constant EIP1271_SUCCESS = 0x1626ba7e;

    PasskeyValidator internal validator;
    P256Signer internal signer;

    bytes32 internal passkeyId;
    bytes32 internal rpHash;
    uint256 internal passkeyPrivateKey;

    function setUp() public {
        validator = new PasskeyValidator();
        signer = new P256Signer();

        // This test contract acts as the account.
        PassKeyDemo.PasskeyCredential memory passkey = PassKeyDemo.getPasskey(1);
        passkeyId = passkey.init.idRaw;
        rpHash = PassKeyDemo.getPasskeyRpHash(1);
        passkeyPrivateKey = uint256(passkey.privateKey);
        validator.onInstall(abi.encode(passkeyId, passkey.init.px, passkey.init.py));
    }

    /// Positive control: a genuine signature does validate, so the fuzz cases below
    /// are rejected by the crypto, not by a broken harness.
    function test_genuineSignatureValidates() public {
        bytes32 hash = keccak256("positive-control");
        bytes memory sig = _sign(hash, 1);
        assertTrue(validator.validateSignatureWithData(hash, sig, abi.encode(address(this))));
        assertEq(validator.isValidSignatureWithSender(address(this), hash, sig), EIP1271_SUCCESS);
        assertEq(_validateUserOp(hash, sig), VALIDATION_SUCCESS);
    }

    /// Arbitrary bytes: either the decode reverts or validation reports failure.
    function testFuzz_randomSignatureBytesNeverValidate(bytes32 hash, bytes calldata sig) public {
        _assertNeverValidates(hash, sig);
    }

    /// Well-formed WebAuthn payloads for the registered passkey (or a random id) with
    /// random r/s, or a genuine signature over a different challenge.
    function testFuzz_randomWebAuthnSignatureNeverValidates(
        bytes32 hash,
        uint256 r,
        uint256 s,
        uint32 counter,
        bool useRegisteredId,
        bool genuineSigOtherChallenge
    ) public {
        bytes32 id = useRegisteredId ? passkeyId : keccak256(abi.encode(hash, r));
        bytes memory authenticatorData = WebAuthnHelper.buildAuthenticatorData(rpHash, true, counter);
        (string memory clientDataJSON, uint256 challengeIndex, uint256 typeIndex) =
            WebAuthnHelper.buildClientDataJSONAndIndices(hash);

        if (genuineSigOtherChallenge) {
            // Real key, real WebAuthn envelope, but signed over a different challenge.
            bytes32 otherHash = keccak256(abi.encode(hash, "other"));
            (string memory otherJSON,,) = WebAuthnHelper.buildClientDataJSONAndIndices(otherHash);
            (r, s) = signer.signDigestWithNonce(
                WebAuthnHelper.webAuthnMessageHash(authenticatorData, otherJSON), passkeyPrivateKey, 0
            );
        }

        bytes memory sig = WebAuthnHelper.encodePasskeySignature(
            id, authenticatorData, clientDataJSON, challengeIndex, typeIndex, r, s
        );
        _assertNeverValidates(hash, sig);
    }

    function _assertNeverValidates(bytes32 hash, bytes memory sig) internal {
        try validator.validateSignatureWithData(hash, sig, abi.encode(address(this))) returns (bool ok) {
            assertFalse(ok, "validateSignatureWithData accepted a random signature");
        } catch {}

        try validator.isValidSignatureWithSender(address(this), hash, sig) returns (bytes4 magic) {
            assertTrue(magic != EIP1271_SUCCESS, "isValidSignatureWithSender accepted a random signature");
        } catch {}

        (bool success, bytes memory ret) = _callValidateUserOp(hash, sig);
        if (success) {
            assertEq(abi.decode(ret, (uint256)) & 1, 1, "validateUserOp accepted a random signature");
        }
    }

    function _validateUserOp(bytes32 hash, bytes memory sig) internal returns (uint256) {
        (bool success, bytes memory ret) = _callValidateUserOp(hash, sig);
        assertTrue(success, "validateUserOp reverted");
        return abi.decode(ret, (uint256));
    }

    function _callValidateUserOp(bytes32 hash, bytes memory sig) internal returns (bool, bytes memory) {
        PackedUserOperation memory userOp;
        userOp.sender = address(this);
        userOp.signature = sig;
        return address(validator).call(abi.encodeCall(PasskeyValidator.validateUserOp, (userOp, hash)));
    }

    function _sign(bytes32 hash, uint32 counter) internal view returns (bytes memory) {
        bytes memory authenticatorData = WebAuthnHelper.buildAuthenticatorData(rpHash, true, counter);
        (string memory clientDataJSON, uint256 challengeIndex, uint256 typeIndex) =
            WebAuthnHelper.buildClientDataJSONAndIndices(hash);
        (uint256 r, uint256 s) = signer.signDigestWithNonce(
            WebAuthnHelper.webAuthnMessageHash(authenticatorData, clientDataJSON), passkeyPrivateKey, 0
        );
        return WebAuthnHelper.encodePasskeySignature(
            passkeyId, authenticatorData, clientDataJSON, challengeIndex, typeIndex, r, s
        );
    }
}
