package com.sprintgames.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.text.TextUtils;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * SprintGames: игра встроена в приложение (assets/www) и открывается во весь экран.
 * Страница отдаётся с адреса http://sprintgames.app/ — так ей разрешено подключаться
 * к серверу в локальной сети по ws:// и http://.
 */
public class MainActivity extends Activity {
    private static final String HOST = "sprintgames.app";
    private WebView web;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(lp);
        }

        web = new WebView(this);
        web.setBackgroundColor(0xFF0B0E14);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setTextZoom(100);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);

        web.addJavascriptInterface(new Bridge(), "SprintApp");
        web.setWebViewClient(new GameClient());

        setContentView(web);
        hideBars();
        if (state != null) web.restoreState(state);
        else new Thread(() -> {
            downloadUpdate();
            runOnUiThread(() -> { if (web != null) web.loadUrl("http://" + HOST + "/"); });
        }).start();
    }

    // Обновление игры без переустановки: свежая версия с сайта, без интернета — последняя скачанная, иначе встроенная
    private static final String UPDATE_URL = "https://sprintgames.vercel.app/index.html";

    private File cachedPage() {
        return new File(getFilesDir(), "index.html");
    }

    private static boolean validPage(String s) {
        return s.length() > 50000 && s.contains("SprintGames") && s.contains("</html>");
    }

    private boolean downloadUpdate() {
        return downloadUpdate(4000);
    }

    private boolean downloadUpdate(int timeout) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(UPDATE_URL + "?u=" + System.currentTimeMillis()).openConnection();
            c.setConnectTimeout(timeout);
            c.setReadTimeout(timeout);
            c.setUseCaches(false);
            if (c.getResponseCode() != 200) return false;
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            try (InputStream in = c.getInputStream()) {
                byte[] b = new byte[16384];
                int n;
                while ((n = in.read(b)) > 0) {
                    out.write(b, 0, n);
                    if (out.size() > 5_000_000) return false;
                }
            }
            byte[] data = out.toByteArray();
            if (!validPage(new String(data, StandardCharsets.UTF_8))) return false;
            File tmp = new File(getFilesDir(), "index.html.tmp");
            try (FileOutputStream f = new FileOutputStream(tmp)) {
                f.write(data);
            }
            if (tmp.renameTo(cachedPage())) return true;
            tmp.delete();
            return false;
        } catch (Exception ignored) {
            return false;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    /** Отдаёт файлы игры из assets/www и не даёт уйти со страницы игры. */
    private class GameClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
            Uri u = req.getUrl();
            if (!HOST.equals(u.getHost())) return null; // сервер в сети — обычным путём
            String p = u.getPath();
            if (p == null || p.equals("/") || p.isEmpty()) p = "/index.html";
            if (p.contains("..")) return notFound();
            try {
                File cached = cachedPage();
                if (p.equals("/index.html") && cached.isFile())
                    return new WebResourceResponse("text/html", "utf-8", new FileInputStream(cached));
            } catch (IOException ignored) {
            }
            try {
                InputStream in = getAssets().open("www" + p);
                return new WebResourceResponse(mime(p), "utf-8", in);
            } catch (IOException e) {
                return notFound();
            }
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
            return !HOST.equals(req.getUrl().getHost()); // никуда не уходим со страницы игры
        }
    }

    private static WebResourceResponse notFound() {
        WebResourceResponse r = new WebResourceResponse("text/plain", "utf-8", new ByteArrayInputStream(new byte[0]));
        r.setStatusCodeAndReasonPhrase(404, "Not Found");
        return r;
    }

    private static String mime(String p) {
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".js")) return "text/javascript";
        if (p.endsWith(".json") || p.endsWith(".webmanifest")) return "application/json";
        if (p.endsWith(".svg")) return "image/svg+xml";
        return "application/octet-stream";
    }

    @SuppressWarnings("deprecation")
    private void hideBars() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideBars();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onPause() {
        super.onPause();
        web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
        hideBars();
    }

    @Override
    protected void onDestroy() {
        if (web != null) web.destroy();
        super.onDestroy();
    }

    // «Назад»: сначала игра сама решает (пауза, выход в меню), из главного меню — выход
    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        web.evaluateJavascript("(window.appBack&&window.appBack())?'1':'0'", v -> {
            if (!"\"1\"".equals(v)) finish();
        });
    }

    /** Мост для JavaScript: window.SprintApp */
    private class Bridge {
        /** IPv4-адреса телефона в локальных сетях (Wi-Fi, точка доступа). */
        @JavascriptInterface
        public String getLocalIps() {
            List<String> out = new ArrayList<>();
            try {
                for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                    if (!ni.isUp() || ni.isLoopback()) continue;
                    for (InetAddress a : Collections.list(ni.getInetAddresses()))
                        if (a instanceof Inet4Address && a.isSiteLocalAddress()) out.add(a.getHostAddress());
                }
            } catch (Exception ignored) {
            }
            return TextUtils.join(",", out);
        }

        @JavascriptInterface
        @SuppressWarnings("deprecation")
        public void vibrate(int ms) {
            try {
                Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
                if (v == null || !v.hasVibrator()) return;
                if (Build.VERSION.SDK_INT >= 26) v.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE));
                else v.vibrate(ms);
            } catch (Exception ignored) {
            }
        }

        /** Открыть сайт игры в обычном браузере (вход через Google). Только адреса sprintgames.vercel.app. */
        @JavascriptInterface
        public void openUrl(String url) {
            if (url == null || !url.startsWith("https://sprintgames.vercel.app/")) return;
            runOnUiThread(() -> {
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                } catch (Exception ignored) {
                }
            });
        }

        /** Кнопка «Обновить»: скачать свежую игру в фоне и перезагрузить страницу. */
        @JavascriptInterface
        public boolean update() {
            new Thread(() -> {
                boolean ok = downloadUpdate(15000);
                runOnUiThread(() -> {
                    if (web == null) return;
                    if (ok) web.reload();
                    else web.evaluateJavascript("sessionStorage.removeItem('sgUpdated');toast('Нет интернета — обновить не получилось');"
                            + "var b=document.getElementById('installBtn');b.disabled=false;b.innerHTML=ICO_UPD+'Обновить';", null);
                });
            }).start();
            return true;
        }

        @JavascriptInterface
        public String version() {
            return "1";
        }
    }
}
