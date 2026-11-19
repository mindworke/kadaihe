package cn.kadai.box;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.*;
import android.hardware.Camera;
import android.os.*;
import android.view.*;
import android.widget.*;
import com.google.zxing.*;
import com.google.zxing.common.HybridBinarizer;
import java.util.Arrays;
import java.util.EnumMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@SuppressWarnings("deprecation")
public final class ScannerActivity extends Activity implements SurfaceHolder.Callback {
    private final ExecutorService decoder = Executors.newSingleThreadExecutor();
    private final MultiFormatReader reader = new MultiFormatReader();
    private SurfaceView preview;
    private FrameLayout viewport;
    private TextView hint;
    private Button lamp;
    private Camera camera;
    private boolean resumed;
    private boolean torch;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(0xff181813);
        getWindow().setNavigationBarColor(0xff181813);
        getWindow().getDecorView().setSystemUiVisibility(0);
        viewport = new FrameLayout(this);
        viewport.setBackgroundColor(0xff181813);
        preview = new SurfaceView(this);
        viewport.addView(preview, new FrameLayout.LayoutParams(-1, -1, Gravity.CENTER));
        preview.getHolder().addCallback(this);
        viewport.addView(new Reticle(), new FrameLayout.LayoutParams(-1, -1));
        Button back = button("‹  返回");
        position(back, Gravity.TOP | Gravity.START, 14, 10);
        back.setOnClickListener(view -> finish());
        lamp = button("开灯");
        position(lamp, Gravity.TOP | Gravity.END, 14, 10);
        lamp.setVisibility(View.GONE);
        lamp.setOnClickListener(view -> toggleFlash());
        hint = new TextView(this);
        hint.setTextColor(0xfffaf7f3);
        hint.setTextSize(16);
        hint.setGravity(Gravity.CENTER);
        hint.setText("将包装条码对准取景框");
        FrameLayout.LayoutParams label = new FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM);
        label.bottomMargin = dp(100);
        label.leftMargin = label.rightMargin = dp(20);
        viewport.addView(hint, label);
        Button manual = button("手动输入条码");
        position(manual, Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL, 0, 31);
        manual.setOnClickListener(view -> manualCode());
        setContentView(viewport);
        Map<DecodeHintType,Object> hints = new EnumMap<>(DecodeHintType.class);
        hints.put(DecodeHintType.POSSIBLE_FORMATS, Arrays.asList(BarcodeFormat.EAN_13, BarcodeFormat.EAN_8,
                BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.CODE_128, BarcodeFormat.CODE_39,
                BarcodeFormat.ITF, BarcodeFormat.QR_CODE));
        hints.put(DecodeHintType.TRY_HARDER, Boolean.TRUE);
        reader.setHints(hints);
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED)
            requestPermissions(new String[]{Manifest.permission.CAMERA}, 1);
    }

    private Button button(String text) {
        Button button = new Button(this);
        button.setText(text);
        button.setTextColor(Color.WHITE);
        button.setTextSize(15);
        button.setAllCaps(false);
        android.graphics.drawable.GradientDrawable background = new android.graphics.drawable.GradientDrawable();
        background.setColor(0xd9383530);
        background.setCornerRadius(dp(14));
        button.setBackground(background);
        button.setPadding(dp(14), 0, dp(14), 0);
        return button;
    }

    private void position(View view, int gravity, int side, int vertical) {
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(-2, dp(48), gravity);
        params.leftMargin = params.rightMargin = dp(side);
        params.topMargin = params.bottomMargin = dp(vertical);
        viewport.addView(view, params);
    }

    private int dp(float value) { return (int) (value * getResources().getDisplayMetrics().density + .5f); }

    @Override protected void onResume() { super.onResume(); resumed = true; openCamera(); }
    @Override protected void onPause() { resumed = false; closeCamera(); super.onPause(); }
    @Override protected void onDestroy() { decoder.shutdownNow(); super.onDestroy(); }
    @Override public void surfaceCreated(SurfaceHolder holder) { openCamera(); }
    @Override public void surfaceChanged(SurfaceHolder holder, int format, int width, int height) { openCamera(); }
    @Override public void surfaceDestroyed(SurfaceHolder holder) { closeCamera(); }

    @Override public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) openCamera();
        else hint.setText("相机权限未开启，可以手动输入条码");
    }

    private void openCamera() {
        if (!resumed || camera != null || !preview.getHolder().getSurface().isValid()
                || checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) return;
        try {
            Camera.CameraInfo info = new Camera.CameraInfo();
            int id = -1;
            for (int i = 0; i < Camera.getNumberOfCameras(); i++) {
                Camera.getCameraInfo(i, info);
                if (info.facing == Camera.CameraInfo.CAMERA_FACING_BACK) { id = i; break; }
            }
            if (id < 0) throw new IllegalStateException("No back camera");
            camera = Camera.open(id);
            Camera.Parameters params = camera.getParameters();
            Camera.Size best = params.getPreviewSize();
            int difference = Integer.MAX_VALUE;
            for (Camera.Size size : params.getSupportedPreviewSizes()) {
                if (size.width < 600 || size.width > 1920) continue;
                int score = Math.abs(size.width - 1280) + Math.abs(size.height - 720);
                if (score < difference) { best = size; difference = score; }
            }
            int width = best.width;
            int height = best.height;
            params.setPreviewSize(width, height);
            params.setPreviewFormat(ImageFormat.NV21);
            java.util.List<String> focusModes = params.getSupportedFocusModes();
            if (focusModes != null && focusModes.contains(Camera.Parameters.FOCUS_MODE_CONTINUOUS_PICTURE))
                params.setFocusMode(Camera.Parameters.FOCUS_MODE_CONTINUOUS_PICTURE);
            else if (focusModes != null && focusModes.contains(Camera.Parameters.FOCUS_MODE_AUTO))
                params.setFocusMode(Camera.Parameters.FOCUS_MODE_AUTO);
            torch = false;
            lamp.setText("开灯");
            lamp.setVisibility(params.getSupportedFlashModes() != null
                    && params.getSupportedFlashModes().contains(Camera.Parameters.FLASH_MODE_TORCH) ? View.VISIBLE : View.GONE);
            camera.setParameters(params);
            int rotation = info.orientation;
            camera.setDisplayOrientation(rotation);
            viewport.post(() -> {
                if (isDestroyed()) return;
                boolean upright = rotation == 90 || rotation == 270;
                int logicalWidth = upright ? height : width;
                int logicalHeight = upright ? width : height;
                float scale = Math.max((float) viewport.getWidth() / logicalWidth, (float) viewport.getHeight() / logicalHeight);
                if (scale > 0) preview.setLayoutParams(new FrameLayout.LayoutParams(
                        Math.round(logicalWidth * scale), Math.round(logicalHeight * scale), Gravity.CENTER));
            });
            camera.setPreviewDisplay(preview.getHolder());
            camera.startPreview();
            preview.setOnClickListener(view -> {
                try { if (camera != null) camera.autoFocus((focused, active) -> {}); }
                catch (RuntimeException ignored) { }
            });
            next(camera, width, height);
        } catch (Exception error) {
            closeCamera();
            hint.setText("相机暂不可用，可以手动输入条码");
        }
    }

    private void next(Camera active, int width, int height) {
        if (camera != active || isFinishing()) return;
        try {
            active.setOneShotPreviewCallback((data, owner) -> {
                if (data == null || data.length < width * height || decoder.isShutdown()) return;
                decoder.execute(() -> {
                    String code = decode(data, width, height);
                    if (code == null) {
                        byte[] rotated = new byte[width * height];
                        for (int y = 0; y < height; y++) {
                            for (int x = 0; x < width; x++) rotated[x * height + height - 1 - y] = data[y * width + x];
                        }
                        code = decode(rotated, height, width);
                    }
                    String scanned = code;
                    runOnUiThread(() -> {
                        if (camera != owner || isFinishing()) return;
                        if (scanned != null && acceptable(scanned)) finishWith(scanned);
                        else preview.postDelayed(() -> next(owner, width, height), 95);
                    });
                });
            });
        } catch (RuntimeException ignored) {}
    }

    private String decode(byte[] data, int width, int height) {
        try {
            int cropWidth = width * 3 / 4, cropHeight = height / 2;
            PlanarYUVLuminanceSource source = new PlanarYUVLuminanceSource(data, width, height,
                    (width - cropWidth) / 2, (height - cropHeight) / 2, cropWidth, cropHeight, false);
            return reader.decodeWithState(new BinaryBitmap(new HybridBinarizer(source))).getText().trim();
        } catch (ReaderException ignored) { return null; }
        finally { reader.reset(); }
    }

    private static boolean acceptable(String code) { return !code.isEmpty() && code.length() <= 100 && !code.matches(".*[\\p{Cntrl}].*"); }

    private void finishWith(String code) {
        setResult(RESULT_OK, new Intent().putExtra("code", code));
        finish();
    }

    private void manualCode() {
        EditText input = new EditText(this);
        input.setSingleLine(true);
        input.setHint("盒底条码");
        input.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.LengthFilter(100)});
        android.app.AlertDialog dialog = new android.app.AlertDialog.Builder(this)
                .setTitle("输入条码").setView(input)
                .setNegativeButton("取消", null).setPositiveButton("确定", null).create();
        input.requestFocus();
        if (dialog.getWindow() != null) dialog.getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE);
        dialog.setOnShowListener(ignored -> dialog.getButton(android.app.AlertDialog.BUTTON_POSITIVE).setOnClickListener(view -> {
            String code = input.getText().toString().trim();
            if (acceptable(code)) finishWith(code);
            else input.setError("请输入包装上的条码");
        }));
        dialog.show();
    }

    private void toggleFlash() {
        try {
            if (camera == null) return;
            Camera.Parameters params = camera.getParameters();
            params.setFlashMode(torch ? Camera.Parameters.FLASH_MODE_OFF : Camera.Parameters.FLASH_MODE_TORCH);
            camera.setParameters(params);
            torch = !torch;
            lamp.setText(torch ? "关灯" : "开灯");
        } catch (RuntimeException ignored) { }
    }

    private void closeCamera() {
        Camera previous = camera;
        camera = null;
        if (previous != null) {
            try { previous.setOneShotPreviewCallback(null); previous.stopPreview(); }
            catch (RuntimeException ignored) { }
            previous.release();
        }
    }

    private final class Reticle extends View {
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);

        Reticle() { super(ScannerActivity.this); setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO); }

        @Override protected void onDraw(Canvas canvas) {
            float half = Math.min(getWidth() * .39f, dp(172));
            float cx = getWidth() / 2f, cy = getHeight() / 2f;
            RectF box = new RectF(cx - half, cy - half * .48f, cx + half, cy + half * .48f);
            Path mask = new Path();
            mask.addRect(0, 0, getWidth(), getHeight(), Path.Direction.CW);
            mask.addRoundRect(box, dp(15), dp(15), Path.Direction.CCW);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(0x90000000);
            canvas.drawPath(mask, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(dp(2));
            paint.setColor(0xfffaf7f3);
            canvas.drawRoundRect(box, dp(15), dp(15), paint);
            paint.setColor(0xffe04b3b);
            canvas.drawLine(box.left + dp(9), cy, box.right - dp(9), cy, paint);
        }
    }
}
