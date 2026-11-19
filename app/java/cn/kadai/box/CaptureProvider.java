package cn.kadai.box;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.File;
import java.io.FileNotFoundException;

public final class CaptureProvider extends ContentProvider {
    static final Uri URI = Uri.parse("content://cn.kadai.box.capture/photo.jpg");

    @Override public boolean onCreate() { return true; }

    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!URI.equals(uri)) throw new FileNotFoundException();
        int flags = ParcelFileDescriptor.parseMode(mode);
        return ParcelFileDescriptor.open(new File(getContext().getCacheDir(), "capture.jpg"), flags);
    }

    @Override public String getType(Uri uri) { return URI.equals(uri) ? "image/jpeg" : null; }
    @Override public Cursor query(Uri uri, String[] projection, String selection, String[] args, String order) {
        if (!URI.equals(uri)) return null;
        String[] columns = projection == null ? new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE} : projection;
        MatrixCursor cursor = new MatrixCursor(columns);
        MatrixCursor.RowBuilder row = cursor.newRow();
        for (String column : columns) {
            if (OpenableColumns.DISPLAY_NAME.equals(column)) row.add("photo.jpg");
            else if (OpenableColumns.SIZE.equals(column)) row.add(new File(getContext().getCacheDir(), "capture.jpg").length());
            else row.add(null);
        }
        return cursor;
    }
    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException(); }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] args) { throw new UnsupportedOperationException(); }
    @Override public int delete(Uri uri, String selection, String[] args) { throw new UnsupportedOperationException(); }
}
