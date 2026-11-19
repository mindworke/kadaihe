package cn.kadai.box;

import android.content.Context;
import android.graphics.BitmapFactory;
import android.util.AtomicFile;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.zip.*;
import org.json.*;

final class Store {
    private static final int MAX_DATA = 4 * 1024 * 1024;
    private static final int MAX_PHOTO = 4 * 1024 * 1024;
    private static final long MAX_BACKUP = 128L * 1024 * 1024;
    private static final Pattern PHOTO_NAME = Pattern.compile("[0-9a-f-]{36}\\.jpg");
    private static final String[] RECORD_GROUPS = {"items", "loans", "wishes"};
    private final File root;

    Store(Context context) { root = context.getFilesDir(); }

    static boolean isPhotoName(String name) { return PHOTO_NAME.matcher(name).matches(); }

    File photo(String name) throws IOException {
        if (!isPhotoName(name)) throw new IOException("Invalid photo");
        File dir = new File(root, "photos");
        if (!dir.isDirectory() && !dir.mkdirs() && !dir.isDirectory()) throw new IOException("No photo folder");
        return new File(dir, name);
    }

    String read() {
        File file = new File(root, "collection.json");
        try (InputStream source = new AtomicFile(file).openRead()) {
            return new String(readLimited(source, MAX_DATA), StandardCharsets.UTF_8);
        } catch (FileNotFoundException missing) {
            return "{}";
        } catch (IOException error) {
            throw new IllegalStateException(error);
        }
    }

    synchronized void write(String data) throws IOException, JSONException {
        JSONObject state = new JSONObject(data);
        validate(state, false);
        byte[] bytes = data.getBytes(StandardCharsets.UTF_8);
        if (bytes.length > MAX_DATA) throw new IOException("Collection is too large");
        AtomicFile file = new AtomicFile(new File(root, "collection.json"));
        FileOutputStream output = file.startWrite();
        try {
            output.write(bytes);
            file.finishWrite(output);
        } catch (IOException error) {
            file.failWrite(output);
            throw error;
        }
    }

    private static void validate(JSONObject state, boolean backup) throws JSONException {
        if (backup && state.optInt("version") != 1) throw new JSONException("Unsupported backup version");
        for (String key : RECORD_GROUPS) {
            JSONArray list = state.getJSONArray(key);
            if (list.length() > 10000) throw new JSONException("Too many items");
            Set<String> ids = new HashSet<>();
            for (int i = 0; i < list.length(); i++) {
                JSONObject entry = list.getJSONObject(i);
                String id = entry.getString("id");
                if (id.isEmpty() || id.length() > 64 || !ids.add(id)) throw new JSONException("Invalid ID");
                if (key.equals("items") || key.equals("wishes")) {
                    String name = entry.getString("name");
                    if (name.trim().isEmpty() || name.length() > 120) throw new JSONException("Invalid name");
                }
                checkPhoto(entry.optString("cover", ""));
                if (key.equals("items")) {
                    if (entry.has("pastPurchases")) {
                        JSONArray history = entry.getJSONArray("pastPurchases");
                        for (int j = 0; j < history.length(); j++) history.getJSONObject(j);
                    }
                    JSONArray photos = entry.optJSONArray("photos");
                    if (photos != null) {
                        if (photos.length() > 12) throw new JSONException("Too many photos");
                        for (int j = 0; j < photos.length(); j++) checkPhoto(photos.getString(j));
                    }
                }
            }
        }
    }

    private static void checkPhoto(String name) throws JSONException {
        if (!name.isEmpty() && !isPhotoName(name) && !name.matches("sample[1-4]"))
            throw new JSONException("Invalid photo name");
    }

    private static Set<String> references(JSONObject state) throws JSONException {
        Set<String> names = new HashSet<>();
        for (String key : RECORD_GROUPS) {
            JSONArray records = state.getJSONArray(key);
            for (int i = 0; i < records.length(); i++) {
                JSONObject record = records.getJSONObject(i);
                String cover = record.optString("cover");
                if (isPhotoName(cover)) names.add(cover);
                JSONArray photos = key.equals("items") ? record.optJSONArray("photos") : null;
                if (photos == null) continue;
                for (int j = 0; j < photos.length(); j++) {
                    String name = photos.getString(j);
                    if (isPhotoName(name)) names.add(name);
                }
            }
        }
        return names;
    }

    void exportTo(OutputStream destination) throws IOException, JSONException {
        String data = read();
        JSONObject state = new JSONObject(data);
        if (state.length() == 0) {
            state = new JSONObject("{\"version\":1,\"items\":[],\"loans\":[],\"wishes\":[]}");
            data = state.toString();
        }
        Set<String> pictures = references(state);
        long totalSize = data.getBytes(StandardCharsets.UTF_8).length;
        for (String name : pictures) {
            File image = photo(name);
            if (!image.isFile()) throw new IOException("Missing photo");
            totalSize += image.length();
        }
        if (totalSize > MAX_BACKUP) throw new IOException("Backup is too large");
        try (ZipOutputStream zip = new ZipOutputStream(destination)) {
            zip.putNextEntry(new ZipEntry("collection.json"));
            zip.write(data.getBytes(StandardCharsets.UTF_8));
            zip.closeEntry();
            for (String name : pictures) {
                zip.putNextEntry(new ZipEntry("photos/" + name));
                try (InputStream image = new FileInputStream(photo(name))) {
                    copyLimited(image, zip, MAX_PHOTO);
                }
                zip.closeEntry();
            }
        }
    }

    String importFrom(InputStream source) throws IOException, JSONException {
        File temp = new File(root, "import-" + java.util.UUID.randomUUID());
        if (!temp.mkdir()) throw new IOException("No staging folder");
        JSONObject state = null;
        long total = 0;
        Set<String> incoming = new HashSet<>();
        try (ZipInputStream zip = new ZipInputStream(source)) {
            for (ZipEntry entry; (entry = zip.getNextEntry()) != null; ) {
                String path = entry.getName();
                if (path.equals("collection.json") && state == null) {
                    byte[] bytes = readLimited(zip, MAX_DATA);
                    state = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
                    validate(state, true);
                    total += bytes.length;
                } else if (path.startsWith("photos/") && isPhotoName(path.substring(7))) {
                    String name = path.substring(7);
                    if (!incoming.add(name)) throw new IOException("Duplicate photo");
                    File target = new File(temp, name);
                    try (OutputStream output = new FileOutputStream(target)) {
                        total += copyLimited(zip, output, MAX_PHOTO);
                    }
                    BitmapFactory.Options bounds = new BitmapFactory.Options();
                    bounds.inJustDecodeBounds = true;
                    BitmapFactory.decodeFile(target.getPath(), bounds);
                    if (bounds.outWidth < 1 || bounds.outHeight < 1 || bounds.outWidth > 1600 || bounds.outHeight > 1600
                            || !"image/jpeg".equals(bounds.outMimeType)) throw new IOException("Invalid backup photo");
                } else {
                    throw new IOException("Unexpected backup entry");
                }
                if (total > MAX_BACKUP) throw new IOException("Backup is too large");
                zip.closeEntry();
            }
            if (state == null || !incoming.equals(references(state))) throw new IOException("Incomplete backup");
            for (String name : incoming) {
                File local = photo(name);
                if (!local.exists() && !new File(temp, name).renameTo(local)) throw new IOException("Cannot restore photo");
            }
            return state.toString();
        } finally {
            File[] files = temp.listFiles();
            if (files != null) for (File part : files) part.delete();
            temp.delete();
        }
    }

    static byte[] readLimited(InputStream source, int limit) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        copyLimited(source, output, limit);
        return output.toByteArray();
    }

    static int copyLimited(InputStream source, OutputStream output, int limit) throws IOException {
        byte[] buffer = new byte[8192];
        int count = 0;
        for (int size; (size = source.read(buffer)) != -1; ) {
            count += size;
            if (count > limit) throw new IOException("Entry is too large");
            output.write(buffer, 0, size);
        }
        return count;
    }
}
