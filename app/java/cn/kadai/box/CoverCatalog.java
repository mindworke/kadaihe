package cn.kadai.box;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.function.UnaryOperator;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

final class CoverCatalog {
    private static final Pattern IMAGE_PATH = Pattern.compile("/?covers/(switch2?)/([A-Za-z0-9_-]+)\\.png");
    private static final Pattern SEPARATORS = Pattern.compile("[\\p{Z}\\p{P}\\s]+");
    private static final Pattern PLATFORM_SUFFIX = Pattern.compile("(nintendoswitch2?|switch2?|ns[12])(?:edition|版)?$");
    private static final int MAX_SUGGESTIONS = 8;
    private final Map<String, List<Entry>> titles = new HashMap<>();
    private final Map<String, List<Entry>> sourceTitles = new HashMap<>();
    private final Map<String, Entry> entries = new LinkedHashMap<>();
    private final UnaryOperator<String> simplify;

    CoverCatalog(JSONObject index, JSONObject translations, UnaryOperator<String> simplify) throws JSONException {
        this.simplify = simplify;
        JSONArray covers = index.getJSONArray("covers");
        if (covers.length() > 20000) throw new JSONException("Too many covers");
        for (int i = 0; i < covers.length(); i++) {
            JSONObject row = covers.optJSONObject(i);
            if (row == null) continue;
            String image = row.optString("image", "");
            Matcher path = IMAGE_PATH.matcher(image);
            String platform = row.optString("platform");
            if (!path.matches() || !platform.equals(path.group(1))) continue;
            if (!image.startsWith("/")) image = "/" + image;
            if (entries.containsKey(image)) continue;
            String id = jsonText(row, "id");
            if (id.isEmpty()) continue;
            JSONObject translation = translations.optJSONObject(id);
            JSONObject shared = sharedNames(translations, translation);
            String source = jsonText(row, "sourceTitle");
            String title = jsonText(row, "chineseTitle");
            String edition = jsonText(row, "edition");
            boolean keyCard = isKeyCard(edition) || isKeyCard(source);
            String localTitle = first(jsonText(translation, "title"), jsonText(shared, "title"));
            String label = jsonText(translation, "label");
            if (label.isEmpty() && !isNormalEdition(edition) && !isKeyCard(edition)) label = edition;
            Entry entry = new Entry(image, platform, first(title, first(localTitle, source)), source, label, keyCard,
                    row.optInt("width"), row.optInt("height"));
            entries.put(image, entry);
            add(titles, title, entry);
            add(titles, localTitle, entry);
            addAliases(row, entry);
            if (translation != null) {
                addAliases(translation, entry);
                if (shared != null) {
                    add(titles, jsonText(shared, "title"), entry);
                    addAliases(shared, entry);
                }
            }
            add(sourceTitles, source, entry);
        }
        if (covers.length() > 0 && entries.isEmpty()) throw new JSONException("No valid covers");
    }

    private static String first(String text, String fallback) { return text.isEmpty() ? fallback : text; }

    private static String jsonText(JSONObject object, String field) {
        return object == null || object.isNull(field) ? "" : object.optString(field).trim();
    }

    private static JSONObject sharedNames(JSONObject translations, JSONObject names) {
        return names == null ? null : translations.optJSONObject(names.optString("aliasesFrom"));
    }

    static JSONArray titleHints(JSONObject translations) {
        JSONArray hints = new JSONArray();
        for (Iterator<String> ids = translations.keys(); ids.hasNext(); ) {
            String id = ids.next();
            JSONObject names = translations.optJSONObject(id);
            JSONObject shared = sharedNames(translations, names);
            String title = first(jsonText(names, "title"), jsonText(shared, "title"));
            if (title.isEmpty()) continue;
            String series = first(jsonText(names, "series"), jsonText(shared, "series"));
            List<String> aliases = new ArrayList<>();
            appendAliases(aliases, names);
            appendAliases(aliases, shared);
            String platform = id.startsWith("switch2-") ? "ns2" : "ns1";
            hints.put(new JSONArray().put(title).put(series).put(String.join(" ", aliases)).put(platform));
        }
        return hints;
    }

    private static void appendAliases(List<String> aliases, JSONObject names) {
        JSONArray values = names == null ? null : names.optJSONArray("aliases");
        if (values == null) return;
        for (int i = 0; i < values.length(); i++) aliases.add(values.optString(i, ""));
    }

    private static boolean isKeyCard(String text) {
        String key = SEPARATORS.matcher(Normalizer.normalize(text, Normalizer.Form.NFKC)
                .toLowerCase(Locale.ROOT)).replaceAll("");
        return key.contains("keycard") || key.contains("キーカード")
                || key.contains("钥匙卡") || key.contains("鑰匙卡") || key.equals("key");
    }

    private static boolean isNormalEdition(String edition) {
        String key = SEPARATORS.matcher(edition.toLowerCase(Locale.ROOT)).replaceAll("");
        return key.isEmpty() || key.equals("standard") || key.equals("normal") || key.equals("physical")
                || key.equals("standardphysical") || key.equals("regular") || key.equals("通常版")
                || key.equals("普通版") || key.equals("普通包装版");
    }

    private String normalize(String text) {
        String normalized = Normalizer.normalize(text, Normalizer.Form.NFKC).toLowerCase(Locale.ROOT);
        return SEPARATORS.matcher(simplify.apply(normalized)).replaceAll("");
    }

    private void add(Map<String, List<Entry>> index, String title, Entry entry) {
        if (title.isEmpty() || title.equals("null")) return;
        String key = normalize(title);
        if (key.isEmpty()) return;
        List<Entry> existing = index.computeIfAbsent(key, ignored -> new ArrayList<>());
        if (!existing.contains(entry)) existing.add(entry);
    }

    private void addAliases(JSONObject names, Entry entry) {
        JSONArray aliases = names.optJSONArray("aliases");
        if (aliases == null) return;
        for (int i = 0; i < aliases.length(); i++) add(titles, aliases.optString(i, ""), entry);
    }

    Entry entry(String image) { return entries.get(image); }

    JSONArray match(String name) throws JSONException {
        String key = normalize(name);
        JSONArray exact = exactMatches(key, "");
        if (exact.length() > 0) return exact;

        String platform = "";
        Matcher suffix = PLATFORM_SUFFIX.matcher(key);
        if (suffix.find() && suffix.start() > 0) {
            platform = suffix.group(1).endsWith("2") ? "switch2" : "switch";
            key = key.substring(0, suffix.start());
            exact = exactMatches(key, platform);
            if (exact.length() > 0) return exact;
        }
        int length = key.codePointCount(0, key.length());
        if (length < 3 && !(length == 2 && key.codePoints().allMatch(ch ->
                Character.UnicodeScript.of(ch) == Character.UnicodeScript.HAN))) return exact;
        return relatedMatches(key, platform);
    }

    private JSONArray exactMatches(String key, String platform) throws JSONException {
        List<Entry> matches = titles.get(key);
        if (matches == null) matches = sourceTitles.get(key);
        JSONArray candidates = new JSONArray();
        if (matches != null) {
            for (Entry entry : matches) {
                if (platform.isEmpty() || entry.platform.equals(platform)) candidates.put(entry.toJson());
            }
        }
        return candidates;
    }

    private JSONArray relatedMatches(String key, String platform) throws JSONException {
        Map<Entry, Integer> ranks = new HashMap<>();
        for (Map.Entry<String, List<Entry>> title : titles.entrySet()) {
            int position = title.getKey().indexOf(key);
            if (position < 0) continue;
            int rank = (position == 0 ? 0 : 1000) + title.getKey().length() - key.length();
            for (Entry entry : title.getValue()) {
                if (platform.isEmpty() || entry.platform.equals(platform)) ranks.merge(entry, rank, Math::min);
            }
        }
        List<Entry> sorted = new ArrayList<>(ranks.keySet());
        sorted.sort(Comparator.comparingInt((Entry entry) -> ranks.get(entry))
                .thenComparing(entry -> entry.title).thenComparing(entry -> entry.image));
        JSONArray suggestions = new JSONArray();
        for (int i = 0; i < Math.min(sorted.size(), MAX_SUGGESTIONS); i++) {
            suggestions.put(sorted.get(i).toJson().put("suggested", true));
        }
        return suggestions;
    }

    static final class Entry {
        final String image;
        final String platform;
        final String title;
        final String sourceTitle;
        final String edition;
        final boolean keyCard;
        final int width;
        final int height;

        Entry(String image, String platform, String title, String sourceTitle, String edition, boolean keyCard, int width, int height) {
            this.image = image;
            this.platform = platform;
            this.title = title;
            this.sourceTitle = sourceTitle;
            this.edition = edition;
            this.keyCard = keyCard;
            this.width = width;
            this.height = height;
        }

        JSONObject toJson() throws JSONException {
            return new JSONObject().put("image", image).put("platform", platform).put("title", title)
                    .put("sourceTitle", sourceTitle).put("edition", edition).put("keyCard", keyCard);
        }
    }
}
