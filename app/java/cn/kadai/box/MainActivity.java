package cn.kadai.box;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.*;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.media.ExifInterface;
import android.net.Uri;
import android.os.*;
import android.provider.MediaStore;
import android.text.InputFilter;
import android.text.InputType;
import android.view.View;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.webkit.*;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.Toast;
import java.io.*;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.GeneralSecurityException;
import java.time.LocalDate;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.UnaryOperator;
import org.json.JSONException;
import org.json.JSONObject;

public final class MainActivity extends Activity {
    private static final String ORIGIN = "https://kadaihe.local";
    private static final int SCAN = 10, PICK = 11, TAKE = 12, EXPORT = 13, IMPORT = 14, NOTIFY = 15;
    private static final int CSV_EXPORT = 16, CSV_IMPORT = 17;
    private static final int MAX_CSV = 8 * 1024 * 1024;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final ExecutorService coverIo = Executors.newSingleThreadExecutor();
    private final AtomicReference<String> activeCoverRequest = new AtomicReference<>();
    private Store store;
    private CoverTokenStore coverToken;
    private CoverLibrary coverLibrary;
    private String coverLibraryOrigin;
    private JSONObject coverTranslations;
    private WebView web;
    private boolean ready;
    private String photoAction = "";
    private String photoId = "";
    private String deferredCall = "";

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        store = new Store(this);
        coverToken = new CoverTokenStore(this);
        coverLibraryOrigin = getString(R.string.cover_library_origin);
        if (saved != null) {
            photoAction = saved.getString("photoAction", "");
            photoId = saved.getString("photoId", "");
        }
        web = new WebView(this);
        web.setBackgroundColor(0xfffaf7f3);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setDomStorageEnabled(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return true; }

            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (!"https".equals(url.getScheme()) || !"kadaihe.local".equals(url.getHost())) return missing();
                String path = url.getPath();
                if (path == null) return missing();
                if (path.startsWith("/photos/")) {
                    try {
                        File image = store.photo(path.substring(8));
                        return response("image/jpeg", new FileInputStream(image));
                    } catch (IOException ignored) { return missing(); }
                }
                String asset = path.substring(1);
                if (!asset.matches("(index\\.html|ui\\.css|app\\.js|catalog\\.js|csv\\.js|sample[1-4]\\.jpg)")) return missing();
                String mime;
                if (asset.endsWith(".html")) mime = "text/html";
                else if (asset.endsWith(".js")) mime = "application/javascript";
                else if (asset.endsWith(".css")) mime = "text/css";
                else mime = "image/jpeg";
                try { return response(mime, getAssets().open(asset)); }
                catch (IOException ignored) { return missing(); }
            }

            @Override public void onPageFinished(WebView view, String url) {
                ready = true;
                if (!deferredCall.isEmpty()) {
                    web.evaluateJavascript(deferredCall, null);
                    deferredCall = "";
                }
            }
        });
        web.addJavascriptInterface(new Bridge(), "Kadai");
        setContentView(web);
        web.loadUrl(ORIGIN + "/index.html");
        openFlow(getIntent());
        LoanReminder.reschedule(this);
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        openFlow(intent);
    }

    private void openFlow(Intent intent) {
        if (intent.getBooleanExtra("openFlow", false))
            event("flow", "in".equals(intent.getStringExtra("flowMode")) ? "in" : "out");
    }

    private WebResourceResponse response(String mime, InputStream stream) {
        Map<String,String> headers = new HashMap<>();
        headers.put("X-Content-Type-Options", "nosniff");
        if (mime.startsWith("image/")) headers.put("Cache-Control", "private, max-age=604800");
        return new WebResourceResponse(mime, mime.startsWith("image/") ? null : "UTF-8", 200, "OK", headers, stream);
    }

    private WebResourceResponse missing() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found",
                Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
    }

    @Override protected void onSaveInstanceState(Bundle state) {
        state.putString("photoAction", photoAction);
        state.putString("photoId", photoId);
        super.onSaveInstanceState(state);
    }

    @Override public void onBackPressed() {
        web.evaluateJavascript("window.appBack && window.appBack()", result -> {
            if (!"true".equals(result)) finish();
        });
    }

    @Override protected void onDestroy() {
        io.shutdown();
        coverIo.shutdownNow();
        web.removeJavascriptInterface("Kadai");
        web.destroy();
        super.onDestroy();
    }

    private void event(String type, String value) {
        runOnUiThread(() -> {
            if (isDestroyed()) return;
            String call = "window.nativeEvent(" + JSONObject.quote(type) + "," + JSONObject.quote(value) + ")";
            if (ready) web.evaluateJavascript(call, null);
            else deferredCall = call;
        });
    }

    private synchronized JSONObject coverTranslations() throws IOException, JSONException {
        if (coverTranslations == null) {
            try (InputStream input = getAssets().open("jp-cover-titles.json")) {
                String names = new String(Store.readLimited(input, 1024 * 1024), StandardCharsets.UTF_8);
                coverTranslations = new JSONObject(names);
            }
        }
        return coverTranslations;
    }

    private CoverLibrary covers() throws IOException, JSONException {
        if (coverLibrary == null) {
            UnaryOperator<String> simplify = Build.VERSION.SDK_INT >= 29
                    ? CoverText.simplifier() : UnaryOperator.identity();
            coverLibrary = new CoverLibrary(coverLibraryOrigin, new File(getCacheDir(), CoverLibrary.CACHE_DIRECTORY),
                    coverTranslations(), simplify);
            File legacy = new File(getCacheDir(), "jp-covers");
            CoverLibrary.clearFiles(legacy);
            legacy.delete();
        }
        return coverLibrary;
    }

    private static final class CoverText {
        static UnaryOperator<String> simplifier() {
            return android.icu.text.Transliterator.getInstance("Traditional-Simplified")::transliterate;
        }
    }

    private void configureCoverToken() {
        EditText input = new EditText(this);
        input.setSingleLine(true);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        input.setImeOptions(EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING);
        input.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO);
        input.setFilters(new InputFilter[]{new InputFilter.LengthFilter(4096)});
        input.setHint("粘贴封面站访问令牌");
        FrameLayout field = new FrameLayout(this);
        int margin = Math.round(24 * getResources().getDisplayMetrics().density);
        field.setPadding(margin, 0, margin, 0);
        field.addView(input);
        AlertDialog.Builder builder = new AlertDialog.Builder(this)
                .setTitle("日版封面站令牌").setView(field)
                .setMessage(coverToken.isConfigured() ? "已配置令牌。粘贴新的令牌可替换。" : "请粘贴私有日版封面站的访问令牌。")
                .setPositiveButton("保存", null).setNegativeButton("取消", null);
        if (coverToken.isConfigured()) builder.setNeutralButton("移除", (dialog, which) -> new AlertDialog.Builder(this)
                .setTitle("移除封面站令牌")
                .setMessage("移除后，需要重新填写令牌才能联网查找日版封面。")
                .setNegativeButton("取消", null)
                .setPositiveButton("确认移除", (confirmation, choice) -> updateCoverToken(""))
                .show());
        AlertDialog dialog = builder.create();
        dialog.show();
        dialog.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(view -> {
            String token = input.getText().toString().trim();
            if (token.regionMatches(true, 0, "Bearer ", 0, 7)) token = token.substring(7).trim();
            if (!token.matches("[!-~]{1,4096}")) {
                input.setError("请粘贴完整的访问令牌");
                return;
            }
            input.getText().clear();
            updateCoverToken(token);
            dialog.dismiss();
        });
    }

    private void updateCoverToken(String token) {
        coverIo.execute(() -> {
            try {
                coverToken.write(token);
                if (coverLibrary != null) coverLibrary.clear();
                else CoverLibrary.clearFiles(new File(getCacheDir(), CoverLibrary.CACHE_DIRECTORY));
                event("cover-token", token.isEmpty() ? "removed" : "saved");
            } catch (IOException | GeneralSecurityException | RuntimeException error) {
                event("message", "无法更新封面站令牌，请重试");
            }
        });
    }

    private void coverFailure(String request, String code) {
        event("cover-error", "{\"request\":" + JSONObject.quote(request) + ",\"code\":" + JSONObject.quote(code) + "}");
    }

    private String requireCoverToken() throws CoverLibrary.SiteError {
        if (coverLibraryOrigin.isEmpty()) throw new CoverLibrary.SiteError("site");
        String token;
        try { token = coverToken.read(); }
        catch (IOException | GeneralSecurityException | RuntimeException error) { throw new CoverLibrary.SiteError("auth"); }
        if (token.isEmpty()) throw new CoverLibrary.SiteError("no-token");
        return token;
    }

    private void launch(Intent intent, int request, String failure) {
        try { startActivityForResult(intent, request); }
        catch (ActivityNotFoundException error) {
            if (request == TAKE) new File(getCacheDir(), "capture.jpg").delete();
            if (request == CSV_EXPORT) stagedCsv().delete();
            event("message", failure);
        }
    }

    private File stagedCsv() { return new File(getCacheDir(), "collection-export.csv"); }

    private void openRecordDocument(int request) {
        boolean export = request == EXPORT || request == CSV_EXPORT;
        Intent intent = new Intent(export ? Intent.ACTION_CREATE_DOCUMENT : Intent.ACTION_OPEN_DOCUMENT)
                .addCategory(Intent.CATEGORY_OPENABLE);
        if (request == EXPORT) {
            intent.setType("application/zip");
            intent.putExtra(Intent.EXTRA_TITLE, "卡带盒备份-" + LocalDate.now() + ".zip");
        } else if (request == CSV_EXPORT) {
            intent.setType("text/csv");
            intent.putExtra(Intent.EXTRA_TITLE, "卡带盒记录-" + LocalDate.now() + ".csv");
        } else {
            intent.setType("*/*");
        }
        launch(intent, request, "手机上没有可用的文件选择器");
    }

    private void handleCsv(int request, Uri uri) {
        try {
            if (request == CSV_EXPORT) {
                try (OutputStream output = getContentResolver().openOutputStream(uri, "wt")) {
                    if (output == null) throw new IOException();
                    Files.copy(stagedCsv().toPath(), output);
                }
                event("message", "CSV 已导出");
            } else {
                byte[] bytes;
                try (InputStream input = getContentResolver().openInputStream(uri)) {
                    if (input == null) throw new IOException();
                    bytes = Store.readLimited(input, MAX_CSV);
                }
                String text;
                try {
                    text = StandardCharsets.UTF_8.newDecoder().decode(ByteBuffer.wrap(bytes)).toString();
                } catch (CharacterCodingException error) {
                    text = Charset.forName("GB18030").newDecoder().decode(ByteBuffer.wrap(bytes)).toString();
                }
                event("csv-import", text);
            }
        } catch (Exception error) {
            event("message", request == CSV_EXPORT ? "CSV 导出失败" : "无法读取这份 CSV，请检查文件格式");
        } finally {
            if (request == CSV_EXPORT) stagedCsv().delete();
        }
    }

    private final class Bridge {
        @JavascriptInterface public String load() {
            try { return store.read(); }
            catch (IllegalStateException error) { return "{\"readError\":true}"; }
        }

        @JavascriptInterface public boolean save(String data) {
            try {
                store.write(data);
            } catch (Exception error) {
                return false;
            }
            try { LoanReminder.reschedule(MainActivity.this); }
            catch (RuntimeException ignored) { }
            return true;
        }

        @JavascriptInterface public boolean coverLibraryAvailable() { return !coverLibraryOrigin.isEmpty(); }

        @JavascriptInterface public boolean hasCoverToken() {
            return coverLibraryAvailable() && coverToken.isConfigured();
        }

        @JavascriptInterface public String coverTitleHints() {
            try { return CoverCatalog.titleHints(coverTranslations()).toString(); }
            catch (IOException | JSONException error) { return "[]"; }
        }

        @JavascriptInterface public void configureCover() {
            runOnUiThread(() -> { if (!isDestroyed() && coverLibraryAvailable()) configureCoverToken(); });
        }

        @JavascriptInterface public void cancelCoverRequest(String request) {
            activeCoverRequest.updateAndGet(current -> request.equals(current) ? null : current);
        }

        @JavascriptInterface public void findCover(String request, String title, boolean refresh) {
            if (title.length() > 120) return;
            activeCoverRequest.set(request);
            coverIo.execute(() -> {
                if (!request.equals(activeCoverRequest.get())) return;
                try {
                    String token = requireCoverToken();
                    JSONObject result = new JSONObject().put("request", request)
                            .put("candidates", covers().match(title, token, refresh));
                    event("cover-found", result.toString());
                } catch (CoverLibrary.SiteError error) {
                    coverFailure(request, error.code);
                } catch (JSONException error) {
                    coverFailure(request, "invalid-index");
                } catch (IOException error) {
                    coverFailure(request, "network");
                } catch (RuntimeException error) {
                    coverFailure(request, "site");
                }
            });
        }

        @JavascriptInterface public void refreshCoverLibrary() {
            coverIo.execute(() -> {
                try {
                    covers().refreshLibrary(requireCoverToken());
                    event("cover-library-updated", "");
                } catch (CoverLibrary.SiteError error) {
                    event("cover-library-error", error.code);
                } catch (JSONException error) {
                    event("cover-library-error", "invalid-index");
                } catch (IOException error) {
                    event("cover-library-error", "network");
                } catch (RuntimeException error) {
                    event("cover-library-error", "site");
                }
            });
        }

        @JavascriptInterface public void downloadCover(String request, String path, boolean refresh) {
            requestCover(request, path, refresh, false);
        }

        @JavascriptInterface public void refreshCurrentCover(String request, String path) {
            requestCover(request, path, true, true);
        }

        private void requestCover(String request, String path, boolean refresh, boolean refreshIndex) {
            activeCoverRequest.set(request);
            coverIo.execute(() -> {
                if (!request.equals(activeCoverRequest.get())) return;
                try {
                    String token = requireCoverToken();
                    CoverLibrary library = covers();
                    if (refreshIndex) library.loadIndex(token, true);
                    File image = library.image(path, token, refresh);
                    if (!request.equals(activeCoverRequest.get())) return;
                    String name;
                    try { name = savePhoto(() -> new FileInputStream(image), false); }
                    catch (InvalidPhoto error) {
                        image.delete();
                        coverFailure(request, "invalid-image");
                        return;
                    } catch (IOException error) {
                        coverFailure(request, "storage");
                        return;
                    }
                    event("cover-downloaded", new JSONObject().put("request", request).put("name", name).toString());
                } catch (CoverLibrary.SiteError error) {
                    coverFailure(request, error.code);
                } catch (IOException error) {
                    coverFailure(request, "network");
                } catch (JSONException | RuntimeException error) {
                    coverFailure(request, "site");
                }
            });
        }

        @JavascriptInterface public void scan() {
            runOnUiThread(() -> launch(new Intent(MainActivity.this, ScannerActivity.class), SCAN, "无法打开扫码"));
        }

        @JavascriptInterface public void photo(String slot, String itemId, boolean camera) {
            runOnUiThread(() -> {
                photoAction = slot;
                photoId = itemId;
                if (camera) {
                    File capture = new File(getCacheDir(), "capture.jpg");
                    capture.delete();
                    Uri uri = CaptureProvider.URI;
                    Intent intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                    intent.putExtra(MediaStore.EXTRA_OUTPUT, uri);
                    intent.setClipData(ClipData.newRawUri("photo", uri));
                    intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                        requestPermissions(new String[] {Manifest.permission.CAMERA}, TAKE);
                    } else launch(intent, TAKE, "手机上没有可用的相机");
                } else {
                    Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("image/*");
                    launch(intent, PICK, "手机上没有可用的图片选择器");
                }
            });
        }

        @JavascriptInterface public void backup(boolean export) {
            runOnUiThread(() -> openRecordDocument(export ? EXPORT : IMPORT));
        }

        @JavascriptInterface public void importCsv() {
            runOnUiThread(() -> openRecordDocument(CSV_IMPORT));
        }

        @JavascriptInterface public void exportCsv(String csv) {
            io.execute(() -> {
                byte[] bytes = csv.getBytes(StandardCharsets.UTF_8);
                if (bytes.length > MAX_CSV) {
                    event("message", "记录超出单次 CSV 导出大小");
                    return;
                }
                try {
                    Files.write(stagedCsv().toPath(), bytes);
                    runOnUiThread(() -> {
                        if (!isDestroyed()) openRecordDocument(CSV_EXPORT);
                    });
                } catch (IOException error) {
                    stagedCsv().delete();
                    event("message", "CSV 导出失败，请检查手机存储空间");
                }
            });
        }

        @JavascriptInterface public void enableNotifications() {
            runOnUiThread(() -> {
                if (Build.VERSION.SDK_INT >= 33
                        && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                    requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFY);
                } else {
                    if (!getSystemService(android.app.NotificationManager.class).areNotificationsEnabled()) {
                        Toast.makeText(MainActivity.this, "请在系统设置中允许卡带盒通知", Toast.LENGTH_LONG).show();
                    }
                    LoanReminder.reschedule(MainActivity.this);
                }
            });
        }
    }

    @Override public void onRequestPermissionsResult(int request, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(request, permissions, results);
        if (request == NOTIFY) {
            if (results.length == 0 || results[0] != PackageManager.PERMISSION_GRANTED) {
                event("notificationDenied", "");
            }
            LoanReminder.reschedule(this);
        }
        if (request == TAKE) {
            if (results.length == 0 || results[0] != PackageManager.PERMISSION_GRANTED) {
                event("message", "需要相机权限才能拍照，也可从相册选择");
                return;
            }
            Intent intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
            intent.putExtra(MediaStore.EXTRA_OUTPUT, CaptureProvider.URI);
            intent.setClipData(ClipData.newRawUri("photo", CaptureProvider.URI));
            intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            launch(intent, TAKE, "手机上没有可用的相机");
        }
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (result != RESULT_OK) {
            if (request == TAKE) new File(getCacheDir(), "capture.jpg").delete();
            if (request == CSV_EXPORT) stagedCsv().delete();
            if (request == SCAN) event("scanCanceled", "");
            return;
        }
        if (request == SCAN) {
            if (data != null && data.hasExtra("code")) event("barcode", data.getStringExtra("code"));
            return;
        }
        Uri uri = data == null ? null : data.getData();
        if (request == PICK || request == TAKE) {
            String slot = photoAction;
            String item = photoId;
            io.execute(() -> readPhoto(request == TAKE, uri, slot, item));
        } else if ((request == CSV_EXPORT || request == CSV_IMPORT) && uri != null) {
            io.execute(() -> handleCsv(request, uri));
        } else if ((request == EXPORT || request == IMPORT) && uri != null) {
            io.execute(() -> {
                try {
                    if (request == EXPORT) {
                        try (OutputStream output = getContentResolver().openOutputStream(uri, "wt")) {
                            if (output == null) throw new IOException();
                            store.exportTo(output);
                        }
                        event("message", "备份已导出");
                    } else {
                        try (InputStream input = getContentResolver().openInputStream(uri)) {
                            if (input == null) throw new IOException();
                            event("import", store.importFrom(input));
                        }
                    }
                } catch (Exception failure) {
                    event("message", request == EXPORT ? "导出失败，请检查可用空间" : "无法读取这份卡带盒备份");
                }
            });
        }
    }

    private InputStream source(boolean camera, Uri uri) throws IOException {
        InputStream stream = camera ? new FileInputStream(new File(getCacheDir(), "capture.jpg"))
                : uri == null ? null : getContentResolver().openInputStream(uri);
        if (stream == null) throw new IOException("No image");
        return stream;
    }

    private void readPhoto(boolean camera, Uri uri, String slot, String item) {
        try {
            String name = savePhoto(() -> source(camera, uri), true);
            event("photo", new JSONObject().put("slot", slot).put("item", item).put("name", name).toString());
        } catch (Exception error) {
            event("message", "无法读取照片，请换一张试试");
        } finally {
            if (camera) new File(getCacheDir(), "capture.jpg").delete();
        }
    }

    private interface PhotoSource { InputStream open() throws IOException; }
    private static final class InvalidPhoto extends IOException {}

    private String savePhoto(PhotoSource source, boolean useExif) throws IOException {
        Bitmap image = null;
        File saved = null;
        boolean success = false;
        try {
            BitmapFactory.Options options = new BitmapFactory.Options();
            options.inJustDecodeBounds = true;
            try (InputStream input = source.open()) { BitmapFactory.decodeStream(input, null, options); }
            if (options.outWidth < 1 || options.outHeight < 1
                    || (!useExif && (options.outWidth > 16384 || options.outHeight > 16384))) throw new InvalidPhoto();
            options.inSampleSize = 1;
            while (Math.max(options.outWidth, options.outHeight) / options.inSampleSize > 1500) options.inSampleSize *= 2;
            options.inJustDecodeBounds = false;
            try (InputStream input = source.open()) { image = BitmapFactory.decodeStream(input, null, options); }
            if (image == null) throw new InvalidPhoto();

            int orientation = ExifInterface.ORIENTATION_NORMAL;
            if (useExif) {
                try (InputStream input = source.open()) {
                    orientation = new ExifInterface(input).getAttributeInt(ExifInterface.TAG_ORIENTATION, orientation);
                } catch (IOException ignored) { }
            }
            Matrix matrix = new Matrix();
            switch (orientation) {
                case 2: matrix.setScale(-1, 1); break;
                case 3: matrix.setRotate(180); break;
                case 4: matrix.setScale(1, -1); break;
                case 5: matrix.setRotate(90); matrix.postScale(-1, 1); break;
                case 6: matrix.setRotate(90); break;
                case 7: matrix.setRotate(270); matrix.postScale(-1, 1); break;
                case 8: matrix.setRotate(270); break;
                default: break;
            }
            if (!matrix.isIdentity()) {
                Bitmap rotated = Bitmap.createBitmap(image, 0, 0, image.getWidth(), image.getHeight(), matrix, true);
                if (rotated != image) image.recycle();
                image = rotated;
            }

            String name = UUID.randomUUID() + ".jpg";
            saved = store.photo(name);
            try (OutputStream output = new FileOutputStream(saved)) {
                if (!image.compress(Bitmap.CompressFormat.JPEG, 85, output)) throw new IOException("Cannot save photo");
            }
            success = true;
            return name;
        } finally {
            if (image != null) image.recycle();
            if (!success && saved != null) saved.delete();
        }
    }
}
