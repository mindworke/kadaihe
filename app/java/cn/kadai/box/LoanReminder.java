package cn.kadai.box;

import android.app.*;
import android.content.*;
import java.time.*;
import java.util.ArrayList;
import java.util.List;
import org.json.*;

public final class LoanReminder extends BroadcastReceiver {
    private static final String CHANNEL = "loan_returns";
    private static final String CHECK = "cn.kadai.box.CHECK_LOANS";

    private static PendingIntent pending(Context context) {
        Intent intent = new Intent(context, LoanReminder.class).setAction(CHECK);
        return PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static void reschedule(Context context) { check(context, false); }

    @Override public void onReceive(Context context, Intent intent) { check(context, CHECK.equals(intent.getAction())); }

    private static synchronized void check(Context context, boolean deliver) {
        AlarmManager alarm = context.getSystemService(AlarmManager.class);
        NotificationManager notifications = context.getSystemService(NotificationManager.class);
        PendingIntent task = pending(context);
        long earliest = Long.MAX_VALUE;
        long now = System.currentTimeMillis();
        List<String> messages = new ArrayList<>();
        String firstDirection = "out";
        SharedPreferences sent = context.getSharedPreferences("sent_reminders", Context.MODE_PRIVATE);
        SharedPreferences.Editor editor = sent.edit();
        try {
            JSONObject state = new JSONObject(new Store(context).read());
            JSONArray loans = state.optJSONArray("loans");
            if (state.optBoolean("reminders") && loans != null && notifications.areNotificationsEnabled()) {
                for (int i = 0; i < loans.length(); i++) {
                    JSONObject loan = loans.optJSONObject(i);
                    if (loan == null || !loan.optString("returned").isEmpty()) continue;
                    String due = loan.optString("due");
                    String key = loan.optString("id") + "/" + due;
                    if (sent.getBoolean(key, false)) continue;
                    long time;
                    try {
                        time = LocalDate.parse(due).atTime(9, 0).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli();
                    } catch (RuntimeException invalidDate) { continue; }
                    if (deliver && time <= now) {
                        String title = loan.optString("game", "卡带");
                        boolean borrowed = "in".equals(loan.optString("direction"));
                        if (messages.isEmpty() && borrowed) firstDirection = "in";
                        messages.add(title + (borrowed ? " · 还给 " : " · 借给 ") +
                                loan.optString("person") + " · 应还 " + due);
                        editor.putBoolean(key, true);
                    } else {
                        earliest = Math.min(earliest, time);
                    }
                }
            }
            if (!messages.isEmpty()) {
                NotificationChannel channel = new NotificationChannel(CHANNEL, "卡带归还提醒", NotificationManager.IMPORTANCE_DEFAULT);
                notifications.createNotificationChannel(channel);
                Intent open = new Intent(context, MainActivity.class).putExtra("openFlow", true)
                        .putExtra("flowMode", firstDirection)
                        .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                PendingIntent openApp = PendingIntent.getActivity(context, 1, open,
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
                Notification.InboxStyle list = new Notification.InboxStyle();
                for (String message : messages.subList(0, Math.min(5, messages.size()))) list.addLine(message);
                notifications.notify(1, new Notification.Builder(context, CHANNEL)
                        .setSmallIcon(R.drawable.notification)
                        .setContentTitle(messages.size() == 1 ? "卡带归还提醒" : messages.size() + " 张卡带待归还")
                        .setContentText(messages.get(0))
                        .setContentIntent(openApp)
                        .setAutoCancel(true)
                        .setStyle(list)
                        .build());
                editor.apply();
            }
        } catch (Exception ignored) { }
        if (earliest == Long.MAX_VALUE) {
            alarm.cancel(task);
        } else {
            alarm.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, Math.max(now + 3000, earliest), task);
        }
    }
}
