package cn.kadai.box;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class CoverTokenStore {
    private static final String KEY_ALIAS = "kadaihe.jp-cover-token";
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int IV_LENGTH = 12;
    private final AtomicFile file;

    CoverTokenStore(Context context) {
        file = new AtomicFile(new File(context.getNoBackupFilesDir(), "jp-cover-token"));
    }

    boolean isConfigured() { return file.getBaseFile().isFile(); }

    String read() throws IOException, GeneralSecurityException {
        if (!isConfigured()) return "";
        try (FileInputStream input = file.openRead()) {
            byte[] iv = new byte[IV_LENGTH];
            new java.io.DataInputStream(input).readFully(iv);
            byte[] encrypted = Store.readLimited(input, 8192);
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.DECRYPT_MODE, secretKey(false), new GCMParameterSpec(128, iv));
            return new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8);
        }
    }

    void write(String token) throws IOException, GeneralSecurityException {
        if (token.isEmpty()) {
            file.delete();
            if (isConfigured()) throw new IOException("Unable to remove token");
            return;
        }
        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(Cipher.ENCRYPT_MODE, secretKey(true));
        byte[] iv = cipher.getIV();
        if (iv.length != IV_LENGTH) throw new GeneralSecurityException("Unexpected IV length");
        byte[] encrypted = cipher.doFinal(token.getBytes(StandardCharsets.UTF_8));
        FileOutputStream output = file.startWrite();
        try {
            output.write(iv);
            output.write(encrypted);
            file.finishWrite(output);
        } catch (IOException error) {
            file.failWrite(output);
            throw error;
        }
    }

    private SecretKey secretKey(boolean create) throws GeneralSecurityException, IOException {
        KeyStore keys = KeyStore.getInstance(KEYSTORE);
        keys.load(null);
        SecretKey key = (SecretKey) keys.getKey(KEY_ALIAS, null);
        if (key != null) return key;
        if (!create) throw new GeneralSecurityException("Missing token key");
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build());
        return generator.generateKey();
    }
}
