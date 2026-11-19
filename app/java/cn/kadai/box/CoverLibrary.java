package cn.kadai.box;

import java.io.DataInputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.Arrays;
import java.util.Comparator;
import java.util.function.UnaryOperator;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

final class CoverLibrary {
    static final String CACHE_DIRECTORY = "jp-covers-framed";
    private static final int MAX_INDEX = 8 * 1024 * 1024;
    private static final int MAX_PNG = 32 * 1024 * 1024;
    private static final long MAX_CACHE = 64L * 1024 * 1024;
    private static final long CACHE_TTL = 24L * 60 * 60 * 1000;

    interface ConnectionFactory { HttpURLConnection open(URL url) throws IOException; }

    private final String origin;
    private final File cache;
    private final File index;
    private final File refreshMarker;
    private final JSONObject translations;
    private final UnaryOperator<String> simplify;
    private final ConnectionFactory connections;
    private CoverCatalog catalog;
    private long loadedAt;

    CoverLibrary(String origin, File cache, JSONObject translations, UnaryOperator<String> simplify) {
        this(origin, cache, translations, simplify, url -> (HttpURLConnection) url.openConnection());
    }

    CoverLibrary(String origin, File cache, JSONObject translations, UnaryOperator<String> simplify,
                 ConnectionFactory connections) {
        this.origin = origin;
        this.cache = cache;
        this.index = new File(cache, "games.json");
        this.refreshMarker = new File(cache, "images-refresh");
        this.translations = translations;
        this.simplify = simplify;
        this.connections = connections;
    }

    JSONArray match(String name, String token, boolean force) throws IOException, JSONException {
        loadIndex(token, force);
        return catalog.match(name);
    }

    void refreshLibrary(String token) throws IOException, JSONException {
        loadIndex(token, true);
        save(refreshMarker, new byte[0]);
    }

    void loadIndex(String token, boolean force) throws IOException, JSONException {
        if (catalog == null && index.isFile()) {
            try (InputStream input = Files.newInputStream(index.toPath())) {
                catalog = parse(Store.readLimited(input, MAX_INDEX));
                loadedAt = index.lastModified();
            } catch (IOException | JSONException damaged) {
                discard(index);
            }
        }
        if (!force && catalog != null && fresh(loadedAt)) return;

        String tag = catalog != null && index.isFile() ? readTag(index) : "";
        HttpURLConnection connection = null;
        try {
            connection = connect("/games.json", token, "application/json", tag);
            int status = status(connection, MAX_INDEX, !tag.isEmpty());
            if (status == HttpURLConnection.HTTP_NOT_MODIFIED) {
                index.setLastModified(System.currentTimeMillis());
            } else {
                byte[] downloaded;
                try (InputStream input = connection.getInputStream()) {
                    downloaded = Store.readLimited(input, MAX_INDEX);
                }
                catalog = parse(downloaded);
                try {
                    save(index, downloaded);
                    markChecked(index, connection);
                } catch (IOException ignored) {
                    discard(index);
                }
            }
            loadedAt = System.currentTimeMillis();
        } catch (IOException failure) {
            if (force || catalog == null || failure instanceof SiteError) throw failure;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    File image(String path, String token, boolean force) throws IOException, JSONException {
        if (catalog == null) loadIndex(token, false);
        CoverCatalog.Entry entry = catalog.entry(path);
        if (entry == null) throw new SiteError("missing");
        String fileName = entry.image.substring(entry.image.lastIndexOf('/') + 1);
        File png = new File(cache, entry.platform + "-" + fileName);
        boolean valid = matchesImage(png, entry);
        long checkedAt = tagFile(png).lastModified();
        if (!force && valid && fresh(checkedAt) && checkedAt >= refreshMarker.lastModified()) return touch(png);

        String tag = valid ? readTag(png) : "";
        HttpURLConnection connection = null;
        try {
            connection = connect(entry.image, token, "image/png", tag);
            int status = status(connection, MAX_PNG, !tag.isEmpty());
            if (status == HttpURLConnection.HTTP_NOT_MODIFIED) {
                tagFile(png).setLastModified(System.currentTimeMillis());
            } else {
                File temp = temporaryFile();
                try {
                    try (InputStream input = connection.getInputStream(); OutputStream output = Files.newOutputStream(temp.toPath())) {
                        Store.copyLimited(input, output, MAX_PNG);
                    }
                    if (!matchesImage(temp, entry)) throw new SiteError("invalid-image");
                    replace(temp, png);
                    markChecked(png, connection);
                    trimImages(png);
                } finally {
                    temp.delete();
                }
            }
        } catch (IOException failure) {
            if (force || !valid || failure instanceof SiteError) throw failure;
        } finally {
            if (connection != null) connection.disconnect();
        }
        return touch(png);
    }

    void clear() {
        catalog = null;
        loadedAt = 0;
        clearFiles(cache);
    }

    static void clearFiles(File cache) {
        File[] files = cache.listFiles();
        if (files != null) for (File file : files) file.delete();
    }

    private CoverCatalog parse(byte[] bytes) throws JSONException {
        return new CoverCatalog(new JSONObject(new String(bytes, StandardCharsets.UTF_8)), translations, simplify);
    }

    private HttpURLConnection connect(String path, String token, String accept, String tag) throws IOException {
        if (token == null || token.isEmpty()) throw new SiteError("no-token");
        HttpURLConnection connection = connections.open(new URL(origin + path));
        connection.setConnectTimeout(12000);
        connection.setReadTimeout(15000);
        connection.setInstanceFollowRedirects(false);
        connection.setUseCaches(false);
        connection.setRequestProperty("Accept", accept);
        connection.setRequestProperty("Cache-Control", "no-cache");
        connection.setRequestProperty("OAI-Sites-Authorization", "Bearer " + token);
        if (!tag.isEmpty()) connection.setRequestProperty("If-None-Match", tag);
        return connection;
    }

    private static int status(HttpURLConnection connection, int limit, boolean conditional) throws IOException {
        int status = connection.getResponseCode();
        if (status == HttpURLConnection.HTTP_NOT_MODIFIED && conditional) return status;
        if (status == 401 || status == 403 || (status >= 300 && status < 400)) throw new SiteError("auth");
        if (status == 404) throw new SiteError("missing");
        if (status >= 500 || status == 408 || status == 429) throw new IOException("Site unavailable");
        if (status != 200) throw new SiteError("site");
        if (connection.getContentLengthLong() > limit) throw new SiteError("size");
        return status;
    }

    private static boolean matchesImage(File file, CoverCatalog.Entry entry) {
        if (!file.isFile()) return false;
        try (DataInputStream input = new DataInputStream(Files.newInputStream(file.toPath()))) {
            if (input.readLong() != 0x89504e470d0a1a0aL || input.readInt() != 13 || input.readInt() != 0x49484452)
                return false;
            int width = input.readInt(), height = input.readInt();
            return width > 0 && height > 0 && (entry.width <= 0 || entry.width == width)
                    && (entry.height <= 0 || entry.height == height);
        } catch (IOException invalid) {
            return false;
        }
    }

    private static boolean fresh(long timestamp) {
        long age = System.currentTimeMillis() - timestamp;
        return timestamp > 0 && age >= 0 && age < CACHE_TTL;
    }

    private static File touch(File resource) {
        resource.setLastModified(System.currentTimeMillis());
        return resource;
    }

    private static File tagFile(File resource) { return new File(resource.getPath() + ".etag"); }

    private static String readTag(File resource) {
        try (InputStream input = Files.newInputStream(tagFile(resource).toPath())) {
            return safeTag(new String(Store.readLimited(input, 512), StandardCharsets.UTF_8));
        } catch (IOException missing) {
            return "";
        }
    }

    private static String safeTag(String tag) {
        return tag != null && tag.length() <= 200 && tag.matches("(W/)?\"[!#-~]*\"") ? tag : "";
    }

    private void markChecked(File resource, HttpURLConnection connection) {
        try {
            save(tagFile(resource), safeTag(connection.getHeaderField("ETag")).getBytes(StandardCharsets.UTF_8));
        } catch (IOException ignored) {
            tagFile(resource).delete();
        }
    }

    private static boolean discard(File resource) {
        tagFile(resource).delete();
        return resource.delete();
    }

    private File temporaryFile() throws IOException {
        if (!cache.isDirectory() && !cache.mkdirs() && !cache.isDirectory()) throw new IOException("No cover cache");
        return File.createTempFile("cover-", ".tmp", cache);
    }

    private void save(File target, byte[] bytes) throws IOException {
        File temp = temporaryFile();
        try {
            Files.write(temp.toPath(), bytes);
            replace(temp, target);
        } finally {
            temp.delete();
        }
    }

    private static void replace(File temp, File target) throws IOException {
        Files.move(temp.toPath(), target.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
    }

    private void trimImages(File keep) {
        File[] images = cache.listFiles((dir, name) -> name.endsWith(".png"));
        if (images == null) return;
        Arrays.sort(images, Comparator.comparingLong(File::lastModified));
        long total = 0;
        for (File image : images) total += image.length();
        for (File image : images) {
            if (total <= MAX_CACHE) break;
            if (image.equals(keep)) continue;
            long length = image.length();
            if (discard(image)) total -= length;
        }
    }

    static final class SiteError extends IOException {
        final String code;
        SiteError(String code) { super(code); this.code = code; }
    }
}
