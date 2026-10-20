use argon2::{Algorithm, Argon2, Params, Version};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chacha20poly1305::{
    aead::{Aead, KeyInit, Payload},
    XChaCha20Poly1305, XNonce,
};
use hkdf::Hkdf;
use rand_core::{OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use x25519_dalek::{PublicKey, StaticSecret};

const KEY_BYTES: usize = 32;
const NONCE_BYTES: usize = 24;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptedPayload {
    nonce: String,
    ciphertext: String,
    ciphertext_hash: String,
    packed_ciphertext: String,
    packed_ciphertext_hash: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceKeyPair {
    private_key: String,
    public_key: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WrappedWorkspaceKey {
    ephemeral_public_key: String,
    nonce: String,
    ciphertext: String,
    ciphertext_hash: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Argon2idParameters {
    memory_kib: u32,
    iterations: u32,
    parallelism: u32,
}

#[tauri::command]
pub fn self_hosted_generate_workspace_key() -> String {
    encode(&random_bytes::<KEY_BYTES>())
}

#[tauri::command]
pub fn self_hosted_generate_device_key_pair() -> DeviceKeyPair {
    let private = StaticSecret::random_from_rng(OsRng);
    let public = PublicKey::from(&private);
    DeviceKeyPair {
        private_key: encode(&private.to_bytes()),
        public_key: encode(public.as_bytes()),
    }
}

#[tauri::command]
pub fn self_hosted_encrypt(
    key: String,
    plaintext: String,
    associated_data: String,
) -> Result<EncryptedPayload, String> {
    encrypt_bytes(
        &decode_fixed::<KEY_BYTES>(&key, "key")?,
        plaintext.as_bytes(),
        associated_data.as_bytes(),
    )
}

#[tauri::command]
pub fn self_hosted_encrypt_bytes(
    key: String,
    plaintext: String,
    associated_data: String,
) -> Result<EncryptedPayload, String> {
    encrypt_bytes(
        &decode_fixed::<KEY_BYTES>(&key, "key")?,
        &decode(&plaintext, "plaintext")?,
        associated_data.as_bytes(),
    )
}

#[tauri::command]
pub fn self_hosted_decrypt(
    key: String,
    nonce: String,
    ciphertext: String,
    associated_data: String,
) -> Result<String, String> {
    let plaintext = decrypt_bytes(
        &decode_fixed::<KEY_BYTES>(&key, "key")?,
        &decode_fixed::<NONCE_BYTES>(&nonce, "nonce")?,
        &decode(&ciphertext, "ciphertext")?,
        associated_data.as_bytes(),
    )?;
    String::from_utf8(plaintext).map_err(|_| "Decrypted value is not valid UTF-8".to_string())
}

#[tauri::command]
pub fn self_hosted_decrypt_packed(
    key: String,
    packed_ciphertext: String,
    associated_data: String,
) -> Result<String, String> {
    let packed = decode(&packed_ciphertext, "packed ciphertext")?;
    if packed.len() <= NONCE_BYTES {
        return Err("Packed ciphertext is invalid".to_string());
    }
    let nonce: [u8; NONCE_BYTES] = packed[..NONCE_BYTES]
        .try_into()
        .map_err(|_| "Packed ciphertext nonce is invalid".to_string())?;
    let plaintext = decrypt_bytes(
        &decode_fixed::<KEY_BYTES>(&key, "key")?,
        &nonce,
        &packed[NONCE_BYTES..],
        associated_data.as_bytes(),
    )?;
    String::from_utf8(plaintext).map_err(|_| "Decrypted value is not valid UTF-8".to_string())
}

#[tauri::command]
pub fn self_hosted_decrypt_packed_bytes(
    key: String,
    packed_ciphertext: String,
    associated_data: String,
) -> Result<String, String> {
    let packed = decode(&packed_ciphertext, "packed ciphertext")?;
    if packed.len() <= NONCE_BYTES {
        return Err("Packed ciphertext is invalid".to_string());
    }
    let nonce: [u8; NONCE_BYTES] = packed[..NONCE_BYTES]
        .try_into()
        .map_err(|_| "Packed ciphertext nonce is invalid".to_string())?;
    let plaintext = decrypt_bytes(
        &decode_fixed::<KEY_BYTES>(&key, "key")?,
        &nonce,
        &packed[NONCE_BYTES..],
        associated_data.as_bytes(),
    )?;
    Ok(encode(&plaintext))
}

#[tauri::command]
pub fn self_hosted_sha256(value: String) -> String {
    encode(&Sha256::digest(value.as_bytes()))
}

#[tauri::command]
pub fn self_hosted_derive_argon2id_key(
    passphrase: String,
    salt: String,
    parameters: Argon2idParameters,
) -> Result<String, String> {
    let salt = decode(&salt, "salt")?;
    if salt.len() < 16 {
        return Err("Argon2id salt must contain at least 16 bytes".to_string());
    }
    let params = Params::new(
        parameters.memory_kib,
        parameters.iterations,
        parameters.parallelism,
        Some(KEY_BYTES),
    )
    .map_err(|_| "Argon2id parameters are invalid".to_string())?;
    let mut output = [0u8; KEY_BYTES];
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(passphrase.as_bytes(), &salt, &mut output)
        .map_err(|_| "Argon2id key derivation failed".to_string())?;
    Ok(encode(&output))
}

#[tauri::command]
pub fn self_hosted_wrap_workspace_key(
    workspace_key: String,
    recipient_public_key: String,
    associated_data: String,
) -> Result<WrappedWorkspaceKey, String> {
    let workspace_key = decode_fixed::<KEY_BYTES>(&workspace_key, "workspace key")?;
    let recipient = PublicKey::from(decode_fixed::<KEY_BYTES>(
        &recipient_public_key,
        "recipient public key",
    )?);
    let ephemeral_private = StaticSecret::random_from_rng(OsRng);
    let ephemeral_public = PublicKey::from(&ephemeral_private);
    let shared = ephemeral_private.diffie_hellman(&recipient);
    let wrapping_key = derive_wrapping_key(shared.as_bytes(), associated_data.as_bytes())?;
    let encrypted = encrypt_bytes(&wrapping_key, &workspace_key, associated_data.as_bytes())?;
    Ok(WrappedWorkspaceKey {
        ephemeral_public_key: encode(ephemeral_public.as_bytes()),
        nonce: encrypted.nonce,
        ciphertext: encrypted.ciphertext,
        ciphertext_hash: encrypted.ciphertext_hash,
    })
}

#[tauri::command]
pub fn self_hosted_unwrap_workspace_key(
    private_key: String,
    ephemeral_public_key: String,
    nonce: String,
    ciphertext: String,
    associated_data: String,
) -> Result<String, String> {
    let private = StaticSecret::from(decode_fixed::<KEY_BYTES>(&private_key, "private key")?);
    let ephemeral = PublicKey::from(decode_fixed::<KEY_BYTES>(
        &ephemeral_public_key,
        "ephemeral public key",
    )?);
    let shared = private.diffie_hellman(&ephemeral);
    let wrapping_key = derive_wrapping_key(shared.as_bytes(), associated_data.as_bytes())?;
    let workspace_key = decrypt_bytes(
        &wrapping_key,
        &decode_fixed::<NONCE_BYTES>(&nonce, "nonce")?,
        &decode(&ciphertext, "ciphertext")?,
        associated_data.as_bytes(),
    )?;
    if workspace_key.len() != KEY_BYTES {
        return Err("Wrapped workspace key has an invalid length".to_string());
    }
    Ok(encode(&workspace_key))
}

fn encrypt_bytes(key: &[u8; KEY_BYTES], plaintext: &[u8], aad: &[u8]) -> Result<EncryptedPayload, String> {
    let cipher = XChaCha20Poly1305::new(key.into());
    let nonce = random_bytes::<NONCE_BYTES>();
    let ciphertext = cipher
        .encrypt(XNonce::from_slice(&nonce), Payload { msg: plaintext, aad })
        .map_err(|_| "Encryption failed".to_string())?;
    let mut packed = Vec::with_capacity(NONCE_BYTES + ciphertext.len());
    packed.extend_from_slice(&nonce);
    packed.extend_from_slice(&ciphertext);
    Ok(EncryptedPayload {
        nonce: encode(&nonce),
        ciphertext: encode(&ciphertext),
        ciphertext_hash: encode(&Sha256::digest(&ciphertext)),
        packed_ciphertext: encode(&packed),
        packed_ciphertext_hash: encode(&Sha256::digest(&packed)),
    })
}

fn decrypt_bytes(
    key: &[u8; KEY_BYTES],
    nonce: &[u8; NONCE_BYTES],
    ciphertext: &[u8],
    aad: &[u8],
) -> Result<Vec<u8>, String> {
    XChaCha20Poly1305::new(key.into())
        .decrypt(XNonce::from_slice(nonce), Payload { msg: ciphertext, aad })
        .map_err(|_| "Decryption failed".to_string())
}

fn derive_wrapping_key(shared: &[u8], context: &[u8]) -> Result<[u8; KEY_BYTES], String> {
    let mut output = [0u8; KEY_BYTES];
    Hkdf::<Sha256>::new(Some(b"notegen-workspace-key-v1"), shared)
        .expand(context, &mut output)
        .map_err(|_| "Workspace key wrapping failed".to_string())?;
    Ok(output)
}

fn random_bytes<const N: usize>() -> [u8; N] {
    let mut bytes = [0u8; N];
    OsRng.fill_bytes(&mut bytes);
    bytes
}

fn decode(value: &str, label: &str) -> Result<Vec<u8>, String> {
    URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| format!("{label} is not valid Base64URL"))
}

fn decode_fixed<const N: usize>(value: &str, label: &str) -> Result<[u8; N], String> {
    decode(value, label)?
        .try_into()
        .map_err(|_| format!("{label} must contain {N} bytes"))
}

fn encode(value: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(value)
}
