using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal static class FolderPickerHost
{
    private const int MaxMessageBytes = 1024 * 1024;
    private const int MaxVerifyFileCount = 256;
    private const int AgentProtocolVersion = 2;
    private const int AgentMinimumProtocolVersion = 1;
    private const string MaintenanceFileName = "maintenance.json";
    private const string UpdateChannel = "stable";
    private const string UpdateManifestUrl = "https://popo-updates-1461466196.cos.ap-guangzhou.myqcloud.com/stable/latest.json";
    private const string UpdateHost = "popo-updates-1461466196.cos.ap-guangzhou.myqcloud.com";
    private const string UpdatePathPrefix = "/stable/";
    // GitHub 备用更新源：清单与安装包都由发布流程上传到 Release；清单单独签名（签名覆盖下载地址）。
    private const string GitHubUpdateManifestUrl =
        "https://github.com/mxwayne/popo-downloader/releases/latest/download/latest.github.json";
    private const string GitHubHost = "github.com";
    private const string GitHubRepositoryPath = "/mxwayne/popo-downloader/";
    private static readonly string[] GitHubAssetHosts = new[] {
        "objects.githubusercontent.com",
        "release-assets.githubusercontent.com",
        "github-releases.githubusercontent.com"
    };
    private const int MaxUpdateRedirects = 5;

    private enum UpdateSource { Cos, GitHub }

    private const string UpdateSigningPublicKeyBase64 = "PFJTQUtleVZhbHVlPjxNb2R1bHVzPndxcWxuZzZkTVZRbHhBUGhpcXl2UC90ZkZmSVdXUVRMakpXaWpzZ3dNcldrUFpBeUtPdlkxNVVLbkQzTmlpSVYzNmtYMnlLZDBIcUZDcEVwcTZoN1pqaTh5bW1ocHJFWGNSTVhaODFiUkV0aTQ5bFpvdlNJUHp0dE42NG9MUHVxa1ZlSnVWQzZHRnlLY1ZxZWVqemJDQW9wWWRKNGdNMFJ3akNLTDlobks0Z1BUVHdCTzBaeEpid0w5b1FUL2NVSnRhVkg1OTVJUVlnRFZYdld1L0Y4aFRuVGZPOTZrRGtTaE03TzNjaDBLQzU5dDZaNW92U3pxeEV2bVB4bzEydnV6NFFaQ2ZJNUdMcGQ5eUNJMVhOWW5YS3E3TndCTFhlRFJvMnIrTTNwQWE1SldmRWZvOVdHcVF1d3J2ajlMSVQxeGhrTjJBbWRZUWl2WXh2eEVpUVBJQTVNV1FRNG9ReFZlSzZwSXRPdmxvcnNrV0kxV25Ed3JpcWRTMVIvT3plU242VVpoa1NiTC9IZWZpSElzd2tRL2lWYlUwYUJKSmpJYWRyUnV1dXpBMWFicy82enRhMkVxUFg2WEVlZ29tTkRrNTBHeGtJTnVYMkIzbmZ6b2gwVWlZc1k2OU1iNXZkVGtjUEkzZVYraXh3UXdYVFEvaEprRVVsOTRBRlZKM0doPC9Nb2R1bHVzPjxFeHBvbmVudD5BUUFCPC9FeHBvbmVudD48L1JTQUtleVZhbHVlPg==";
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();

    [STAThread]
    private static int Main(string[] args)
    {
        if (HasArgument(args, "--apply-update"))
        {
            return RunDetachedUpdater(args);
        }
#if POPO_NATIVEHOST_TEST
        if (HasArgument(args, "--test-validate-manifest")) return RunTestValidateManifest(args);
        if (HasArgument(args, "--test-check-url")) return RunTestCheckUrl(args);
        if (HasArgument(args, "--test-foreign-gopeed")) return RunTestForeignGopeed(args);
#endif
        try
        {
            Dictionary<string, object> request = ReadMessage();
            if (request == null) return 0;

            string action = GetString(request, "action");
            if (String.Equals(action, "ping", StringComparison.Ordinal))
            {
                WriteMessage(new {
                    ok = true,
                    version = 3,
                    capabilities = new[] {
                        "choose_folder",
                        "ensure_gopeed",
                        "verify_files",
                        "agent_connection",
                        "check_update",
                        "apply_update",
                        "update_status"
                    }
                });
                return 0;
            }
            if (String.Equals(action, "ensure_gopeed", StringComparison.Ordinal))
            {
                WriteMessage(EnsureGopeed(GetString(request, "apiToken")));
                return 0;
            }
            if (String.Equals(action, "verify_files", StringComparison.Ordinal))
            {
                WriteMessage(VerifyFiles(request));
                return 0;
            }
            if (String.Equals(action, "agent_connection", StringComparison.Ordinal))
            {
                WriteMessage(ReadAgentConnection());
                return 0;
            }
            if (String.Equals(action, "check_update", StringComparison.Ordinal))
            {
                WriteMessage(CheckForUpdate(GetString(request, "currentVersion")));
                return 0;
            }
            if (String.Equals(action, "apply_update", StringComparison.Ordinal))
            {
                WriteMessage(StartUpdate(GetString(request, "currentVersion")));
                return 0;
            }
            if (String.Equals(action, "update_status", StringComparison.Ordinal))
            {
                WriteMessage(ReadUpdateStatus(GetProductRoot()));
                return 0;
            }
            if (!String.Equals(action, "choose_folder", StringComparison.Ordinal))
            {
                WriteMessage(new { ok = false, error = "不支持的本机助手操作" });
                return 0;
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            using (FolderBrowserDialog dialog = new FolderBrowserDialog())
            using (Form owner = CreateOwnerWindow())
            {
                dialog.Description = "选择 POPO 文件保存根目录";
                dialog.ShowNewFolderButton = true;
                string initialPath = GetString(request, "initialPath");
                if (!String.IsNullOrWhiteSpace(initialPath) && Directory.Exists(initialPath))
                {
                    dialog.SelectedPath = initialPath;
                }

                owner.Show();
                DialogResult result = dialog.ShowDialog(owner);
                owner.Close();
                if (result != DialogResult.OK || String.IsNullOrWhiteSpace(dialog.SelectedPath))
                {
                    WriteMessage(new { ok = true, cancelled = true, path = "" });
                    return 0;
                }

                WriteMessage(new {
                    ok = true,
                    cancelled = false,
                    path = Path.GetFullPath(dialog.SelectedPath)
                });
            }
            return 0;
        }
        catch (Exception error)
        {
            try
            {
                WriteMessage(new { ok = false, error = error.Message });
            }
            catch
            {
                // Chrome reports a closed native host if even the error reply cannot be written.
            }
            return 1;
        }
    }

    private static Form CreateOwnerWindow()
    {
        return new Form {
            Text = "POPO 稳定下载助手",
            ShowInTaskbar = false,
            StartPosition = FormStartPosition.Manual,
            Left = -32000,
            Top = -32000,
            Width = 1,
            Height = 1,
            Opacity = 0,
            TopMost = true
        };
    }

#if POPO_NATIVEHOST_TEST
    // 测试入口：判断是否有别人的 Gopeed 窗口（argv: --test-foreign-gopeed <内置 gopeed.exe 路径> <结果文件>）。
    private static int RunTestForeignGopeed(string[] args)
    {
        int index = Array.IndexOf(args, "--test-foreign-gopeed");
        string foreignPath;
        string result = TryFindForeignGopeedWindow(Path.GetFullPath(args[index + 1]), out foreignPath)
            ? "FOREIGN:" + foreignPath
            : "NONE";
        File.WriteAllText(args[index + 2], result, new UTF8Encoding(false));
        return 0;
    }

    // 测试入口：校验一份清单文件（argv: --test-validate-manifest <json> <cos|github> <结果文件>）。
    private static int RunTestValidateManifest(string[] args)
    {
        int index = Array.IndexOf(args, "--test-validate-manifest");
        string result;
        try
        {
            UpdateManifest manifest = Json.Deserialize<UpdateManifest>(File.ReadAllText(args[index + 1]));
            UpdateSource source = String.Equals(args[index + 2], "github", StringComparison.OrdinalIgnoreCase)
                ? UpdateSource.GitHub
                : UpdateSource.Cos;
            ValidateUpdateManifest(manifest, source);
            result = "OK";
        }
        catch (Exception error)
        {
            result = "ERR:" + error.Message;
        }
        File.WriteAllText(args[index + 3], result, new UTF8Encoding(false));
        return 0;
    }

    // 测试入口：判断一个地址能否作为更新重定向目标（argv: --test-check-url <url> <结果文件>）。
    private static int RunTestCheckUrl(string[] args)
    {
        int index = Array.IndexOf(args, "--test-check-url");
        Uri uri;
        bool allowed = Uri.TryCreate(args[index + 1], UriKind.Absolute, out uri) && IsAllowedGitHubUrl(uri);
        File.WriteAllText(args[index + 2], allowed ? "ALLOWED" : "DENIED", new UTF8Encoding(false));
        return 0;
    }
#endif

    private sealed class UpdateManifest
    {
        public int schemaVersion { get; set; }
        public string channel { get; set; }
        public string version { get; set; }
        public string chromeVersion { get; set; }
        public string publishedAt { get; set; }
        public string artifact { get; set; }
        public string url { get; set; }
        public string sha256 { get; set; }
        public long size { get; set; }
        public string signature { get; set; }
        public string notes { get; set; }
    }

    private static object CheckForUpdate(string currentVersion)
    {
        try
        {
            string productRoot = GetProductRoot();
            string installedVersion = GetInstalledVersion(productRoot);
            UpdateManifest manifest = ReadAndValidateUpdateManifest();
            bool available = CompareVersions(manifest.version, installedVersion) > 0;
            return new {
                ok = true,
                available = available,
                channel = manifest.channel,
                currentVersion = currentVersion,
                installedVersion = installedVersion,
                runtimeMatchesInstalled = String.Equals(
                    currentVersion,
                    installedVersion,
                    StringComparison.OrdinalIgnoreCase
                ),
                version = manifest.version,
                publishedAt = manifest.publishedAt,
                notes = manifest.notes
            };
        }
        catch (Exception error)
        {
            return new {
                ok = false,
                error = error.Message,
                errorCode = ClassifyUpdateCheckError(error)
            };
        }
    }

    private static string ClassifyUpdateCheckError(Exception error)
    {
        if (error is WebException) return "LEGACY_NETWORK_ERROR";
        if (error is CryptographicException) return "LEGACY_SIGNATURE_INVALID";
        if (error is InvalidDataException) return "LEGACY_MANIFEST_INVALID";
        return "LEGACY_CHECK_FAILED";
    }

    private static object StartUpdate(string currentVersion)
    {
        try
        {
            string productRoot = GetProductRoot();
            string installedVersion = GetInstalledVersion(productRoot);
            UpdateManifest manifest = ReadAndValidateUpdateManifest();
            if (CompareVersions(manifest.version, installedVersion) <= 0)
            {
                return new {
                    ok = true,
                    started = false,
                    available = false,
                    installedVersion = installedVersion,
                    runtimeMatchesInstalled = String.Equals(
                        currentVersion,
                        installedVersion,
                        StringComparison.OrdinalIgnoreCase
                    ),
                    version = manifest.version
                };
            }

            string updaterRoot = Path.Combine(
                Path.GetTempPath(),
                "POPOStableDownloader",
                "updater-" + Guid.NewGuid().ToString("N")
            );
            Directory.CreateDirectory(updaterRoot);
            string updaterExecutable = Path.Combine(updaterRoot, "PopoUpdater.exe");
            File.Copy(Application.ExecutablePath, updaterExecutable, true);
            WriteUpdateStatus(
                productRoot,
                "starting",
                installedVersion,
                manifest.version,
                "Verified update is starting."
            );

            ProcessStartInfo startInfo = new ProcessStartInfo {
                FileName = updaterExecutable,
                Arguments = "--apply-update --product-root " + QuoteArgument(productRoot) +
                    " --current-version " + QuoteArgument(installedVersion) +
                    " --target-version " + QuoteArgument(manifest.version) +
                    " --parent-pid " + Process.GetCurrentProcess().Id,
                WorkingDirectory = updaterRoot,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden
            };
            Process updater = Process.Start(startInfo);
            if (updater == null)
            {
                throw new InvalidOperationException("The detached updater did not start.");
            }
            int updaterProcessId = updater.Id;
            updater.Dispose();
            return new {
                ok = true,
                started = true,
                available = true,
                version = manifest.version,
                processId = updaterProcessId
            };
        }
        catch (Exception error)
        {
            return new { ok = false, error = error.Message };
        }
    }

    private static int RunDetachedUpdater(string[] args)
    {
        string productRoot = GetArgumentValue(args, "--product-root");
        string currentVersion = GetArgumentValue(args, "--current-version");
        string targetVersion = GetArgumentValue(args, "--target-version");
        string workRoot = "";
        try
        {
            if (String.IsNullOrWhiteSpace(productRoot))
            {
                throw new InvalidDataException("The updater install root is missing.");
            }
            productRoot = Path.GetFullPath(productRoot);
            WaitForParentExit(GetIntArgument(args, "--parent-pid"));

            WriteUpdateStatus(productRoot, "checking", currentVersion, targetVersion, "Checking signed update metadata.");
            UpdateManifest manifest = ReadAndValidateUpdateManifest();
            if (!String.Equals(manifest.version, targetVersion, StringComparison.Ordinal))
            {
                throw new InvalidDataException("The update target changed before installation.");
            }
            if (CompareVersions(manifest.version, currentVersion) <= 0)
            {
                WriteUpdateStatus(productRoot, "up_to_date", currentVersion, manifest.version, "The installed version is current.");
                return 0;
            }

            string updatesRoot = Path.Combine(productRoot, "Updates");
            Directory.CreateDirectory(updatesRoot);
            workRoot = Path.Combine(updatesRoot, "download-" + Guid.NewGuid().ToString("N"));
            string archivePath = Path.Combine(workRoot, manifest.artifact);
            string extractRoot = Path.Combine(workRoot, "package");
            Directory.CreateDirectory(workRoot);

            WriteUpdateStatus(productRoot, "downloading", currentVersion, manifest.version, "Downloading verified update package.");
            try
            {
                DownloadUpdatePackage(manifest, archivePath);
                VerifyDownloadedPackage(manifest, archivePath);
            }
            catch (Exception downloadError)
            {
                // 清单来自腾讯云但安装包下载失败：同一版本的 GitHub 清单（同样经过签名校验）可以作为备用。
                UpdateManifest fallback = null;
                if (String.Equals(new Uri(manifest.url).Host, UpdateHost, StringComparison.OrdinalIgnoreCase))
                {
                    try { fallback = FetchUpdateManifest(UpdateSource.GitHub); } catch {}
                }
                if (fallback == null || !String.Equals(fallback.version, manifest.version, StringComparison.Ordinal))
                {
                    throw downloadError;
                }
                manifest = fallback;
                try { if (File.Exists(archivePath)) File.Delete(archivePath); } catch {}
                archivePath = Path.Combine(workRoot, manifest.artifact);
                WriteUpdateStatus(productRoot, "downloading", currentVersion, manifest.version, "Downloading verified update package from the GitHub backup source.");
                DownloadUpdatePackage(manifest, archivePath);
                VerifyDownloadedPackage(manifest, archivePath);
            }

            WriteUpdateStatus(productRoot, "installing", currentVersion, manifest.version, "Installing verified candidate package.");
            ExtractUpdatePackage(archivePath, extractRoot);
            string packageRoot = FindExtractedPackageRoot(extractRoot);
            string setupExecutable = ResolveSetupExecutable(packageRoot);

            ProcessStartInfo setupInfo = new ProcessStartInfo {
                FileName = setupExecutable,
                Arguments = "--quiet --install-root " + QuoteArgument(productRoot),
                WorkingDirectory = packageRoot,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden
            };
            using (Process setup = Process.Start(setupInfo))
            {
                if (setup == null)
                {
                    throw new InvalidOperationException("The verified setup process did not start.");
                }
                if (!setup.WaitForExit(180000))
                {
                    try { setup.Kill(); } catch {}
                    throw new TimeoutException("The verified setup process did not finish within three minutes.");
                }
                if (setup.ExitCode != 0)
                {
                    throw new InvalidOperationException("The verified setup process failed with exit code " + setup.ExitCode + ".");
                }
            }

            WriteUpdateStatus(productRoot, "succeeded", currentVersion, manifest.version, "The signed update was installed successfully.");
            return 0;
        }
        catch (Exception error)
        {
            try
            {
                if (!String.IsNullOrWhiteSpace(productRoot))
                {
                    WriteUpdateStatus(productRoot, "failed", currentVersion, targetVersion, error.Message);
                }
            }
            catch {}
            return 1;
        }
        finally
        {
            TryDeleteUpdateWorkRoot(productRoot, workRoot);
        }
    }

    // 先读腾讯云清单；失败（网络、校验）时改读 GitHub 清单。GitHub 清单同样必须通过签名校验，
    // 所以放宽来源不会削弱完整性保证。两个来源都失败时抛出腾讯云那次的错误，保持原有的错误分类。
    private static UpdateManifest ReadAndValidateUpdateManifest()
    {
        try
        {
            return FetchUpdateManifest(UpdateSource.Cos);
        }
        catch (Exception cosError)
        {
            try
            {
                return FetchUpdateManifest(UpdateSource.GitHub);
            }
            catch
            {
                throw cosError;
            }
        }
    }

    private static UpdateManifest FetchUpdateManifest(UpdateSource source)
    {
        ServicePointManager.SecurityProtocol |= (SecurityProtocolType)3072;
        string json;
        if (source == UpdateSource.Cos)
        {
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create(UpdateManifestUrl);
            request.Method = "GET";
            request.AllowAutoRedirect = false;
            request.KeepAlive = false;
            request.Timeout = 10000;
            request.ReadWriteTimeout = 10000;
            request.UserAgent = "POPOStableDownloader-Updater/1";
            using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
            using (StreamReader reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
            {
                if (response.StatusCode != HttpStatusCode.OK)
                {
                    throw new InvalidDataException("The update service returned HTTP " + (int)response.StatusCode + ".");
                }
                json = reader.ReadToEnd();
            }
        }
        else
        {
            using (HttpWebResponse response = GetWithValidatedRedirects(GitHubUpdateManifestUrl, 10000, 10000))
            using (StreamReader reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
            {
                if (response.StatusCode != HttpStatusCode.OK)
                {
                    throw new InvalidDataException("The GitHub update source returned HTTP " + (int)response.StatusCode + ".");
                }
                json = reader.ReadToEnd();
            }
        }

        UpdateManifest manifest = Json.Deserialize<UpdateManifest>(json);
        ValidateUpdateManifest(manifest, source);
        return manifest;
    }

    // GitHub 下载会 302 到它自己的资产域名。逐跳手动跟随，每一跳都校验目标，不使用自动重定向。
    private static HttpWebResponse GetWithValidatedRedirects(string url, int timeoutMs, int readWriteTimeoutMs)
    {
        string current = url;
        for (int hop = 0; hop <= MaxUpdateRedirects; hop++)
        {
            Uri currentUri = new Uri(current);
            if (!IsAllowedGitHubUrl(currentUri))
            {
                throw new InvalidDataException("The update redirect target is not an approved GitHub address.");
            }
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create(currentUri);
            request.Method = "GET";
            request.AllowAutoRedirect = false;
            request.KeepAlive = false;
            request.Timeout = timeoutMs;
            request.ReadWriteTimeout = readWriteTimeoutMs;
            request.UserAgent = "POPOStableDownloader-Updater/1";
            HttpWebResponse response = (HttpWebResponse)request.GetResponse();
            int code = (int)response.StatusCode;
            if (code >= 300 && code < 400)
            {
                string location = response.Headers["Location"];
                response.Close();
                Uri next;
                if (String.IsNullOrWhiteSpace(location) || !Uri.TryCreate(currentUri, location, out next))
                {
                    throw new InvalidDataException("The update redirect is missing a valid target.");
                }
                current = next.AbsoluteUri;
                continue;
            }
            return response;
        }
        throw new InvalidDataException("The update service redirected too many times.");
    }

    // 只允许 https、默认端口、无用户信息，并且主机属于仓库页面或 GitHub 的发布资产域名。
    private static bool IsAllowedGitHubUrl(Uri uri)
    {
        if (uri == null || !uri.IsAbsoluteUri) return false;
        if (!String.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase)) return false;
        if (uri.Port != 443 || !String.IsNullOrEmpty(uri.UserInfo)) return false;
        if (String.Equals(uri.Host, GitHubHost, StringComparison.OrdinalIgnoreCase))
        {
            return uri.AbsolutePath.StartsWith(GitHubRepositoryPath, StringComparison.Ordinal);
        }
        foreach (string host in GitHubAssetHosts)
        {
            if (String.Equals(uri.Host, host, StringComparison.OrdinalIgnoreCase)) return true;
        }
        return false;
    }

    private static string GetUpdatePublicKeyBase64()
    {
#if POPO_NATIVEHOST_TEST
        string overrideKey = Environment.GetEnvironmentVariable("POPO_NATIVEHOST_TEST_PUBLIC_KEY_B64");
        if (!String.IsNullOrEmpty(overrideKey)) return overrideKey;
#endif
        return UpdateSigningPublicKeyBase64;
    }

    private static void ValidateUpdateManifest(UpdateManifest manifest, UpdateSource source)
    {
        if (manifest == null || manifest.schemaVersion != 1)
        {
            throw new InvalidDataException("The update metadata schema is not supported.");
        }
        if (!String.Equals(manifest.channel, UpdateChannel, StringComparison.Ordinal))
        {
            throw new InvalidDataException("The update channel is not stable.");
        }
        Version parsedVersion;
        Version parsedChromeVersion;
        if (!Version.TryParse(manifest.version, out parsedVersion) ||
            !Version.TryParse(manifest.chromeVersion, out parsedChromeVersion))
        {
            throw new InvalidDataException("The update version is invalid.");
        }
        if (String.IsNullOrWhiteSpace(manifest.publishedAt) ||
            String.IsNullOrWhiteSpace(manifest.artifact) ||
            !String.Equals(Path.GetFileName(manifest.artifact), manifest.artifact, StringComparison.Ordinal) ||
            manifest.size <= 0 || manifest.size > 250L * 1024L * 1024L ||
            !IsSha256(manifest.sha256) ||
            String.IsNullOrWhiteSpace(manifest.signature))
        {
            throw new InvalidDataException("The update metadata is incomplete.");
        }

        Uri packageUri;
        if (source == UpdateSource.Cos)
        {
            if (!Uri.TryCreate(manifest.url, UriKind.Absolute, out packageUri) ||
                !String.Equals(packageUri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase) ||
                !String.Equals(packageUri.Host, UpdateHost, StringComparison.OrdinalIgnoreCase) ||
                !packageUri.AbsolutePath.StartsWith(UpdatePathPrefix, StringComparison.Ordinal) ||
                !String.Equals(Path.GetFileName(packageUri.LocalPath), manifest.artifact, StringComparison.Ordinal))
            {
                throw new InvalidDataException("The update package URL is not an approved COS object.");
            }
        }
        else
        {
            // 地址必须是本仓库当前版本的 Release 资产：/mxwayne/popo-downloader/releases/download/v<版本>/<文件名>。
            string expectedPrefix = GitHubRepositoryPath + "releases/download/v" + manifest.version + "/";
            if (!Uri.TryCreate(manifest.url, UriKind.Absolute, out packageUri) ||
                !String.Equals(packageUri.Host, GitHubHost, StringComparison.OrdinalIgnoreCase) ||
                !IsAllowedGitHubUrl(packageUri) ||
                !packageUri.AbsolutePath.StartsWith(expectedPrefix, StringComparison.Ordinal) ||
                !String.Equals(Path.GetFileName(packageUri.LocalPath), manifest.artifact, StringComparison.Ordinal))
            {
                throw new InvalidDataException("The update package URL is not an approved GitHub release asset.");
            }
        }

        string canonical = CanonicalUpdateManifest(manifest);
        byte[] signature;
        try
        {
            signature = Convert.FromBase64String(manifest.signature);
        }
        catch (FormatException)
        {
            throw new InvalidDataException("The update signature encoding is invalid.");
        }
        string publicXml = Encoding.UTF8.GetString(Convert.FromBase64String(GetUpdatePublicKeyBase64()));
        using (RSACryptoServiceProvider rsa = new RSACryptoServiceProvider())
        {
            rsa.FromXmlString(publicXml);
            if (!rsa.VerifyData(
                Encoding.UTF8.GetBytes(canonical),
                CryptoConfig.MapNameToOID("SHA256"),
                signature
            ))
            {
                throw new CryptographicException("The update metadata signature is invalid.");
            }
        }
    }

    private static string CanonicalUpdateManifest(UpdateManifest manifest)
    {
        return String.Join("\n", new[] {
            Convert.ToString(manifest.schemaVersion),
            manifest.channel,
            manifest.version,
            manifest.chromeVersion,
            manifest.publishedAt,
            manifest.artifact,
            manifest.url,
            manifest.sha256,
            Convert.ToString(manifest.size)
        });
    }

    private static void DownloadUpdatePackage(UpdateManifest manifest, string destination)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(destination));
        Uri packageUri = new Uri(manifest.url);
        bool fromGitHub = String.Equals(packageUri.Host, GitHubHost, StringComparison.OrdinalIgnoreCase);
        HttpWebResponse response;
        if (fromGitHub)
        {
            response = GetWithValidatedRedirects(manifest.url, 15000, 60000);
        }
        else
        {
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create(manifest.url);
            request.Method = "GET";
            request.AllowAutoRedirect = false;
            request.KeepAlive = false;
            request.Timeout = 15000;
            request.ReadWriteTimeout = 60000;
            request.UserAgent = "POPOStableDownloader-Updater/1";
            response = (HttpWebResponse)request.GetResponse();
        }
        long written = 0;
        using (response)
        using (Stream input = response.GetResponseStream())
        using (FileStream output = new FileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.None))
        {
            if (response.StatusCode != HttpStatusCode.OK)
            {
                throw new InvalidDataException("The update package returned HTTP " + (int)response.StatusCode + ".");
            }
            byte[] buffer = new byte[128 * 1024];
            int count;
            while ((count = input.Read(buffer, 0, buffer.Length)) > 0)
            {
                output.Write(buffer, 0, count);
                written += count;
                if (written > manifest.size)
                {
                    throw new InvalidDataException("The update package is larger than its signed size.");
                }
            }
        }
        if (written != manifest.size)
        {
            throw new InvalidDataException("The update package size does not match its signed metadata.");
        }
    }

    private static void VerifyDownloadedPackage(UpdateManifest manifest, string archivePath)
    {
        string actualHash;
        using (FileStream stream = File.OpenRead(archivePath))
        using (SHA256 sha256 = SHA256.Create())
        {
            byte[] digest = sha256.ComputeHash(stream);
            StringBuilder value = new StringBuilder(digest.Length * 2);
            foreach (byte item in digest) value.Append(item.ToString("x2"));
            actualHash = value.ToString();
        }
        if (!String.Equals(actualHash, manifest.sha256, StringComparison.OrdinalIgnoreCase))
        {
            throw new CryptographicException("The update package SHA-256 does not match its signed metadata.");
        }
    }

    private static void ExtractUpdatePackage(string archivePath, string extractRoot)
    {
        Directory.CreateDirectory(extractRoot);
        string rootPrefix = Path.GetFullPath(extractRoot).TrimEnd(Path.DirectorySeparatorChar) +
            Path.DirectorySeparatorChar;
        using (ZipArchive archive = ZipFile.OpenRead(archivePath))
        {
            foreach (ZipArchiveEntry entry in archive.Entries)
            {
                string relative = entry.FullName.Replace('/', Path.DirectorySeparatorChar);
                string destination = Path.GetFullPath(Path.Combine(extractRoot, relative));
                if (!destination.StartsWith(rootPrefix, StringComparison.OrdinalIgnoreCase))
                {
                    throw new InvalidDataException("The update archive contains an unsafe path.");
                }
                if (String.IsNullOrEmpty(entry.Name))
                {
                    Directory.CreateDirectory(destination);
                    continue;
                }
                Directory.CreateDirectory(Path.GetDirectoryName(destination));
                using (Stream input = entry.Open())
                using (FileStream output = new FileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                {
                    input.CopyTo(output);
                }
            }
        }
    }

    private static string FindExtractedPackageRoot(string extractRoot)
    {
        string[] roots = Directory.GetDirectories(extractRoot);
        if (roots.Length != 1 || Directory.GetFiles(extractRoot).Length != 0)
        {
            throw new InvalidDataException("The update archive must contain exactly one package directory.");
        }
        return roots[0];
    }

    private static string ResolveSetupExecutable(string packageRoot)
    {
        string[] candidates = {
            "popo-setup.exe",
            "popo-dev-setup.exe",
            "POPO-Setup.exe",
            "POPO-Dev-Setup.exe"
        };
        foreach (string name in candidates)
        {
            string candidate = Path.Combine(packageRoot, name);
            if (File.Exists(candidate)) return candidate;
        }
        throw new InvalidDataException("The signed update package is missing the setup executable.");
    }

    private static object ReadUpdateStatus(string productRoot)
    {
        string path = Path.Combine(productRoot, "Updates", "update-status.json");
        if (!File.Exists(path))
        {
            return new { ok = true, state = "idle", currentVersion = "", targetVersion = "", message = "" };
        }
        Dictionary<string, object> status = Json.Deserialize<Dictionary<string, object>>(
            File.ReadAllText(path, Encoding.UTF8)
        );
        status["ok"] = true;
        return status;
    }

    private static void WriteUpdateStatus(
        string productRoot,
        string state,
        string currentVersion,
        string targetVersion,
        string message
    )
    {
        string updatesRoot = Path.Combine(productRoot, "Updates");
        Directory.CreateDirectory(updatesRoot);
        string path = Path.Combine(updatesRoot, "update-status.json");
        string temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        Dictionary<string, object> status = new Dictionary<string, object> {
            { "state", state },
            { "currentVersion", currentVersion ?? "" },
            { "targetVersion", targetVersion ?? "" },
            { "message", message ?? "" },
            { "updatedAt", DateTimeOffset.Now.ToString("o") }
        };
        File.WriteAllText(temporary, Json.Serialize(status), new UTF8Encoding(false));
        if (File.Exists(path))
        {
            File.Replace(temporary, path, null);
        }
        else
        {
            File.Move(temporary, path);
        }
    }

    private static string GetProductRoot()
    {
        DirectoryInfo nativeRoot = new DirectoryInfo(AppDomain.CurrentDomain.BaseDirectory.TrimEnd(
            Path.DirectorySeparatorChar,
            Path.AltDirectorySeparatorChar
        ));
        if (nativeRoot.Parent == null)
        {
            throw new InvalidOperationException("The installed POPO root could not be determined.");
        }
        string productRoot = nativeRoot.Parent.FullName;
        if (!File.Exists(Path.Combine(productRoot, "install-state.json")))
        {
            throw new InvalidOperationException("Automatic updates require the installed green package.");
        }
        return productRoot;
    }

    private static string GetInstalledVersion(string productRoot)
    {
        string statePath = Path.Combine(productRoot, "install-state.json");
        Dictionary<string, object> state = Json.Deserialize<Dictionary<string, object>>(
            File.ReadAllText(statePath, Encoding.UTF8)
        );
        string installedVersion = GetString(state, "version");
        Version parsed;
        if (!Version.TryParse(installedVersion, out parsed))
        {
            throw new InvalidDataException("The managed POPO install version is invalid.");
        }
        return installedVersion;
    }

    private static int CompareVersions(string left, string right)
    {
        Version leftVersion;
        Version rightVersion;
        if (!Version.TryParse(left, out leftVersion) || !Version.TryParse(right, out rightVersion))
        {
            throw new InvalidDataException("A stable update version is invalid.");
        }
        return leftVersion.CompareTo(rightVersion);
    }

    private static bool IsSha256(string value)
    {
        if (String.IsNullOrWhiteSpace(value) || value.Length != 64) return false;
        foreach (char item in value)
        {
            bool hex = (item >= '0' && item <= '9') ||
                (item >= 'a' && item <= 'f') ||
                (item >= 'A' && item <= 'F');
            if (!hex) return false;
        }
        return true;
    }

    private static void WaitForParentExit(int parentProcessId)
    {
        if (parentProcessId <= 0) return;
        try
        {
            using (Process parent = Process.GetProcessById(parentProcessId))
            {
                parent.WaitForExit(15000);
            }
        }
        catch
        {
            // The native messaging host may already have exited.
        }
    }

    private static void TryDeleteUpdateWorkRoot(string productRoot, string workRoot)
    {
        if (String.IsNullOrWhiteSpace(productRoot) || String.IsNullOrWhiteSpace(workRoot)) return;
        try
        {
            string updatesRoot = Path.GetFullPath(Path.Combine(productRoot, "Updates"))
                .TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            string fullWorkRoot = Path.GetFullPath(workRoot).TrimEnd(Path.DirectorySeparatorChar);
            if (fullWorkRoot.StartsWith(updatesRoot, StringComparison.OrdinalIgnoreCase) &&
                Directory.Exists(fullWorkRoot))
            {
                Directory.Delete(fullWorkRoot, true);
            }
        }
        catch
        {
            // A later update can safely reuse a new transaction directory.
        }
    }

    private static bool HasArgument(string[] args, string expected)
    {
        if (args == null) return false;
        foreach (string value in args)
        {
            if (String.Equals(value, expected, StringComparison.OrdinalIgnoreCase)) return true;
        }
        return false;
    }

    private static string GetArgumentValue(string[] args, string name)
    {
        if (args == null) return "";
        for (int index = 0; index + 1 < args.Length; index++)
        {
            if (String.Equals(args[index], name, StringComparison.OrdinalIgnoreCase))
            {
                return args[index + 1];
            }
        }
        return "";
    }

    private static int GetIntArgument(string[] args, string name)
    {
        int value;
        return Int32.TryParse(GetArgumentValue(args, name), out value) ? value : 0;
    }

    private static string QuoteArgument(string value)
    {
        return "\"" + (value ?? "").Replace("\"", "") + "\"";
    }

    private static object EnsureGopeed(string existingToken)
    {
        string maintenanceMessage;
        if (IsMaintenanceActive(out maintenanceMessage))
        {
            return new {
                ok = false,
                maintenance = true,
                retryable = true,
                error = maintenanceMessage
            };
        }
        string gopeedPath = Path.GetFullPath(Path.Combine(
            AppDomain.CurrentDomain.BaseDirectory,
            "Gopeed",
            "gopeed.exe"
        ));
        if (!File.Exists(gopeedPath))
        {
            return new {
                ok = false,
                error = "The bundled Gopeed executable is missing. Run START-HERE.cmd again."
            };
        }

        string apiToken = ResolveGopeedApiToken(gopeedPath, existingToken);

        int readyPort;
        int readyProcessId;
        bool readyBundled;
        if (TryFindGopeedEndpoint(gopeedPath, out readyPort, out readyProcessId, out readyBundled))
        {
            return new {
                ok = true,
                endpoint = "http://127.0.0.1:" + readyPort,
                apiToken = apiToken,
                bundled = readyBundled,
                started = false,
                processId = readyProcessId
            };
        }

        bool started = false;
        int startedProcessId = 0;
        if (FindBundledGopeedProcess(gopeedPath) == 0)
        {
            // Gopeed 的 Windows 入口是“按窗口标题的全局单实例”：再启动一个 gopeed.exe，
            // 它不会启动自己，而是把已有的 gopeed 窗口（哪怕在托盘里隐藏）显示并抢到前台，然后退出。
            // 所以别人的 Gopeed 在运行时绝不能再启动，否则每次点扩展都会弹窗并抢焦点。
            string foreignPath;
            if (TryFindForeignGopeedWindow(gopeedPath, out foreignPath))
            {
                return new {
                    ok = false,
                    foreignGopeed = true,
                    error = "另一个 Gopeed 正在运行并占用了 Gopeed 窗口"
                        + (foreignPath.Length > 0 ? "（" + foreignPath + "）" : "")
                        + "。POPO 不会强行把它调到前台；请在托盘里退出它后重试。"
                };
            }
            WriteGopeedTokenBridge(gopeedPath, apiToken);
            ProcessStartInfo startInfo = new ProcessStartInfo {
                FileName = gopeedPath,
                Arguments = "--hidden",
                WorkingDirectory = Path.GetDirectoryName(gopeedPath),
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden
            };
            Process process = Process.Start(startInfo);
            if (process == null)
            {
                return new { ok = false, error = "Bundled Gopeed did not start." };
            }
            started = true;
            startedProcessId = process.Id;
            process.Dispose();
        }

        for (int attempt = 0; attempt < 80; attempt++)
        {
            if (TryFindGopeedEndpoint(
                gopeedPath,
                out readyPort,
                out readyProcessId,
                out readyBundled
            ))
            {
                return new {
                    ok = true,
                    endpoint = "http://127.0.0.1:" + readyPort,
                    apiToken = apiToken,
                    bundled = readyBundled,
                    started = started,
                    processId = readyProcessId
                };
            }
            Thread.Sleep(250);
        }

        return new {
            ok = false,
            error = "Gopeed started but its local API was not ready within 20 seconds.",
            started = started,
            processId = startedProcessId
        };
    }

    private static string ResolveGopeedApiToken(string gopeedPath, string existingToken)
    {
        string storageRoot = Path.Combine(Path.GetDirectoryName(gopeedPath), "storage");
        Directory.CreateDirectory(storageRoot);
        string protectedPath = Path.Combine(storageRoot, ".popo-api-token.dpapi");
        string bridgePath = Path.Combine(storageRoot, ".popo-api-token.bridge");
        string token = "";

        if (File.Exists(bridgePath))
        {
            try { token = ValidateApiToken(File.ReadAllText(bridgePath, Encoding.UTF8)); }
            catch { token = ""; }
            try { File.Delete(bridgePath); } catch { }
        }
        if (token.Length == 0 && File.Exists(protectedPath))
        {
            try
            {
                byte[] protectedBytes = File.ReadAllBytes(protectedPath);
                byte[] tokenBytes = ProtectedData.Unprotect(
                    protectedBytes,
                    Encoding.UTF8.GetBytes("POPO-Gopeed-API-Token-v1"),
                    DataProtectionScope.CurrentUser
                );
                token = ValidateApiToken(Encoding.UTF8.GetString(tokenBytes));
                Array.Clear(tokenBytes, 0, tokenBytes.Length);
            }
            catch { token = ""; }
        }
        if (token.Length == 0) token = ValidateApiToken(existingToken);
        if (token.Length == 0) token = CreateApiToken();

        byte[] clearBytes = Encoding.UTF8.GetBytes(token);
        byte[] protectedData = ProtectedData.Protect(
            clearBytes,
            Encoding.UTF8.GetBytes("POPO-Gopeed-API-Token-v1"),
            DataProtectionScope.CurrentUser
        );
        Array.Clear(clearBytes, 0, clearBytes.Length);
        string temporaryPath = protectedPath + ".tmp";
        File.WriteAllBytes(temporaryPath, protectedData);
        if (File.Exists(protectedPath)) File.Replace(temporaryPath, protectedPath, null);
        else File.Move(temporaryPath, protectedPath);
        Array.Clear(protectedData, 0, protectedData.Length);
        return token;
    }

    private static void WriteGopeedTokenBridge(string gopeedPath, string token)
    {
        string storageRoot = Path.Combine(Path.GetDirectoryName(gopeedPath), "storage");
        Directory.CreateDirectory(storageRoot);
        string bridgePath = Path.Combine(storageRoot, ".popo-api-token.bridge");
        File.WriteAllText(bridgePath, token, new UTF8Encoding(false));
    }

    private static string ValidateApiToken(string value)
    {
        if (String.IsNullOrWhiteSpace(value) || value.Length > 4096) return "";
        foreach (char character in value)
        {
            if (Char.IsControl(character)) return "";
        }
        return value.Trim();
    }

    private static string CreateApiToken()
    {
        byte[] bytes = new byte[32];
        using (RNGCryptoServiceProvider random = new RNGCryptoServiceProvider())
        {
            random.GetBytes(bytes);
        }
        string token = Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        Array.Clear(bytes, 0, bytes.Length);
        return token;
    }

    private static bool IsMaintenanceActive(out string message)
    {
        message = "POPO 正在安装或修复，Gopeed 自动启动已暂时暂停。完成后会自动恢复。";
        string nativeRoot = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(
            Path.DirectorySeparatorChar,
            Path.AltDirectorySeparatorChar
        );
        DirectoryInfo parent = Directory.GetParent(nativeRoot);
        if (parent == null) return false;
        string markerPath = Path.Combine(parent.FullName, "Updates", MaintenanceFileName);
        if (!File.Exists(markerPath)) return false;

        bool active = false;
        try
        {
            Dictionary<string, object> marker = Json.Deserialize<Dictionary<string, object>>(
                File.ReadAllText(markerPath, Encoding.UTF8)
            );
            int processId = GetInteger(marker, "processId");
            DateTimeOffset expiresAt;
            if (processId > 0 &&
                DateTimeOffset.TryParse(GetString(marker, "expiresAt"), out expiresAt) &&
                expiresAt > DateTimeOffset.Now)
            {
                using (Process installer = Process.GetProcessById(processId))
                {
                    active = !installer.HasExited;
                }
            }
        }
        catch {}

        if (!active)
        {
            try
            {
                active = File.GetLastWriteTimeUtc(markerPath) > DateTime.UtcNow.AddMinutes(-2);
            }
            catch {}
        }
        if (active) return true;
        try { File.Delete(markerPath); } catch {}
        return false;
    }

    private static object VerifyFiles(Dictionary<string, object> request)
    {
        object rawFiles;
        IList files = request != null && request.TryGetValue("files", out rawFiles)
            ? rawFiles as IList
            : null;
        if (files == null || files.Count == 0 || files.Count > MaxVerifyFileCount)
        {
            return new { ok = false, error = "本机文件核对请求数量不正确" };
        }

        List<object> results = new List<object>();
        foreach (object rawFile in files)
        {
            Dictionary<string, object> file = rawFile as Dictionary<string, object>;
            string key = GetString(file, "key");
            string requestedPath = GetString(file, "path");
            long expectedSize = GetLong(file, "expectedSize");
            if (String.IsNullOrWhiteSpace(key) || key.Length > 512 ||
                String.IsNullOrWhiteSpace(requestedPath) || requestedPath.Length > 32767 ||
                !IsLocalDriveAbsolutePath(requestedPath))
            {
                return new { ok = false, error = "本机文件核对路径不正确" };
            }

            string fullPath;
            try
            {
                fullPath = Path.GetFullPath(requestedPath);
            }
            catch
            {
                return new { ok = false, error = "本机文件核对路径无法解析" };
            }

            bool exists = false;
            long actualSize = 0;
            try
            {
                FileInfo info = new FileInfo(fullPath);
                exists = info.Exists;
                if (exists) actualSize = info.Length;
            }
            catch
            {
                exists = false;
                actualSize = 0;
            }
            bool sizeMatches = exists && actualSize > 0 &&
                (expectedSize <= 0 || actualSize == expectedSize);
            results.Add(new {
                key = key,
                exists = exists,
                size = actualSize,
                sizeMatches = sizeMatches
            });
        }
        return new { ok = true, files = results.ToArray() };
    }

    private static bool IsLocalDriveAbsolutePath(string value)
    {
        return !String.IsNullOrWhiteSpace(value) && value.Length >= 3 &&
            Char.IsLetter(value[0]) && value[1] == ':' &&
            (value[2] == '\\' || value[2] == '/');
    }

    private static object ReadAgentConnection()
    {
        try
        {
            string productRoot = GetProductRoot();
            string agentRoot = Path.Combine(productRoot, "Agent");
            string endpointPath = Path.Combine(agentRoot, "endpoint.json");
            string tokenPath = Path.Combine(agentRoot, "auth.token");
            if (!File.Exists(endpointPath) || !File.Exists(tokenPath))
            {
                return new { ok = false, error = "POPO update agent is not running." };
            }
            Dictionary<string, object> endpoint = Json.Deserialize<Dictionary<string, object>>(
                File.ReadAllText(endpointPath, Encoding.UTF8)
            );
            int port = GetInteger(endpoint, "port");
            int processId = GetInteger(endpoint, "processId");
            int protocol = GetInteger(endpoint, "protocol");
            int minimumProtocol = GetInteger(endpoint, "minimumProtocol");
            if (!String.Equals(GetString(endpoint, "address"), "127.0.0.1", StringComparison.Ordinal) ||
                port < 49152 || port > 65535 || processId <= 0 ||
                protocol < minimumProtocol ||
                protocol < AgentMinimumProtocolVersion ||
                AgentProtocolVersion < minimumProtocol)
            {
                throw new InvalidDataException("The POPO update agent endpoint is invalid.");
            }
            using (Process agent = Process.GetProcessById(processId))
            {
                string expected = Path.GetFullPath(Path.Combine(agentRoot, "PopoAgent.exe"));
                string actual = Path.GetFullPath(agent.MainModule.FileName);
                if (!String.Equals(expected, actual, StringComparison.OrdinalIgnoreCase))
                {
                    throw new InvalidDataException("The POPO update agent process identity does not match.");
                }
            }
            if (!FindListeningPorts(processId).Contains(port))
            {
                throw new InvalidDataException("The POPO update agent endpoint does not belong to its process.");
            }

            byte[] encrypted = File.ReadAllBytes(tokenPath);
            if (encrypted.Length == 0 || encrypted.Length > 16 * 1024)
            {
                throw new InvalidDataException("The encrypted POPO update agent token has an invalid size.");
            }
            byte[] entropy = Encoding.UTF8.GetBytes("POPO agent access token v1");
            byte[] plain = ProtectedData.Unprotect(encrypted, entropy, DataProtectionScope.CurrentUser);
            string token;
            try
            {
                if (plain.Length != 32)
                {
                    throw new InvalidDataException("The POPO update agent token has an invalid size.");
                }
                token = Convert.ToBase64String(plain);
            }
            finally { Array.Clear(plain, 0, plain.Length); }
            return new {
                ok = true,
                endpoint = "http://127.0.0.1:" + port,
                token = token,
                protocol = protocol,
                minimumProtocol = minimumProtocol
            };
        }
        catch (Exception error)
        {
            return new { ok = false, error = error.Message };
        }
    }

    private static bool TryFindGopeedEndpoint(
        string expectedPath,
        out int port,
        out int processId,
        out bool bundled
    )
    {
        port = 0;
        processId = 0;
        bundled = false;
        int bundledProcessId = FindBundledGopeedProcess(expectedPath);
        if (bundledProcessId <= 0) return false;
        List<int> processIds = new List<int> { bundledProcessId };
        foreach (int candidateProcessId in processIds)
        {
            foreach (int candidatePort in FindListeningPorts(candidateProcessId))
            {
                if (!IsGopeedApi(candidatePort)) continue;
                port = candidatePort;
                processId = candidateProcessId;
                bundled = candidateProcessId == bundledProcessId && bundledProcessId > 0;
                return true;
            }
        }
        return false;
    }

    // ====== Gopeed 窗口占用检测：与 Gopeed 入口（windows/runner/main.cpp）使用同一个类名与标题 ======
    private const string GopeedWindowClass = "FLUTTER_RUNNER_WIN32_WINDOW";
    private const string GopeedWindowTitle = "gopeed";
    private const uint ProcessQueryLimitedInformation = 0x1000;

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr FindWindow(string className, string windowName);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint access, bool inheritHandle, uint processId);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool QueryFullProcessImageName(IntPtr process, int flags, StringBuilder path, ref int size);

    // 已有 gopeed 窗口、且它不属于 expectedPath 指向的内置 Gopeed 时返回 true（foreignPath 为空表示读不到路径）。
    private static bool TryFindForeignGopeedWindow(string expectedPath, out string foreignPath)
    {
        foreignPath = "";
        string title = GopeedWindowTitle;
#if POPO_NATIVEHOST_TEST
        string overrideTitle = Environment.GetEnvironmentVariable("POPO_NATIVEHOST_TEST_GOPEED_TITLE");
        if (!String.IsNullOrEmpty(overrideTitle)) title = overrideTitle;
#endif
        IntPtr window = FindWindow(GopeedWindowClass, title);
        if (window == IntPtr.Zero) return false;
        uint ownerId;
        GetWindowThreadProcessId(window, out ownerId);
        string ownerPath = ownerId == 0 ? "" : ReadProcessImagePath(ownerId);
        if (ownerPath.Length > 0 &&
            String.Equals(ownerPath, expectedPath, StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }
        foreignPath = ownerPath;
        return true;
    }

    private static string ReadProcessImagePath(uint processId)
    {
        IntPtr handle = OpenProcess(ProcessQueryLimitedInformation, false, processId);
        if (handle == IntPtr.Zero) return "";
        try
        {
            StringBuilder buffer = new StringBuilder(1024);
            int size = buffer.Capacity;
            if (!QueryFullProcessImageName(handle, 0, buffer, ref size)) return "";
            return Path.GetFullPath(buffer.ToString());
        }
        catch
        {
            return "";
        }
        finally
        {
            CloseHandle(handle);
        }
    }

    private static int FindBundledGopeedProcess(string expectedPath)
    {
        foreach (int processId in FindGopeedProcessIds())
        {
            try
            {
                using (Process process = Process.GetProcessById(processId))
                {
                    string actualPath = Path.GetFullPath(process.MainModule.FileName);
                    if (String.Equals(actualPath, expectedPath, StringComparison.OrdinalIgnoreCase))
                    {
                        return processId;
                    }
                }
            }
            catch
            {
                // Processes can exit between enumeration and inspection.
            }
        }
        return 0;
    }

    private static List<int> FindGopeedProcessIds()
    {
        List<int> result = new List<int>();
        foreach (Process process in Process.GetProcessesByName("gopeed"))
        {
            try
            {
                result.Add(process.Id);
            }
            catch
            {
                // Ignore a process that exited while being enumerated.
            }
            finally
            {
                process.Dispose();
            }
        }
        return result;
    }

    private static List<int> FindListeningPorts(int processId)
    {
        List<int> ports = new List<int>();
        ProcessStartInfo startInfo = new ProcessStartInfo {
            FileName = Path.Combine(Environment.SystemDirectory, "netstat.exe"),
            Arguments = "-ano -p tcp",
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };
        using (Process netstat = Process.Start(startInfo))
        {
            if (netstat == null) return ports;
            string output = "";
            Thread outputReader = new Thread(delegate()
            {
                output = netstat.StandardOutput.ReadToEnd();
            });
            outputReader.IsBackground = true;
            outputReader.Start();
            if (!netstat.WaitForExit(3000))
            {
                try { netstat.Kill(); } catch {}
                outputReader.Join(1000);
                return ports;
            }
            outputReader.Join(1000);
            foreach (string line in output.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries))
            {
                string[] parts = line.Split((char[])null, StringSplitOptions.RemoveEmptyEntries);
                if (parts.Length < 5 ||
                    !String.Equals(parts[0], "TCP", StringComparison.OrdinalIgnoreCase) ||
                    !String.Equals(parts[3], "LISTENING", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }
                int rowProcessId;
                if (!Int32.TryParse(parts[parts.Length - 1], out rowProcessId) || rowProcessId != processId)
                {
                    continue;
                }
                string localAddress = parts[1];
                int colon = localAddress.LastIndexOf(':');
                int port;
                if (colon < 0 || !Int32.TryParse(localAddress.Substring(colon + 1), out port))
                {
                    continue;
                }
                string listenerAddress = localAddress.Substring(0, colon).Trim('[', ']');
                if (!String.Equals(listenerAddress, "127.0.0.1", StringComparison.Ordinal) &&
                    !String.Equals(listenerAddress, "::1", StringComparison.Ordinal))
                {
                    continue;
                }
                if (port > 0 && !ports.Contains(port)) ports.Add(port);
            }
        }
        return ports;
    }

    private static bool IsGopeedApi(int port)
    {
        try
        {
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create(
                "http://127.0.0.1:" + port + "/api/v1/config"
            );
            request.Method = "GET";
            request.Proxy = null;
            request.KeepAlive = false;
            request.Timeout = 1200;
            request.ReadWriteTimeout = 1200;
            using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
            using (StreamReader reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
            {
                if (response.StatusCode != HttpStatusCode.OK) return false;
                Dictionary<string, object> envelope = Json.Deserialize<Dictionary<string, object>>(
                    reader.ReadToEnd()
                );
                object codeValue;
                object dataValue;
                if (envelope == null ||
                    !envelope.TryGetValue("code", out codeValue) ||
                    Convert.ToInt32(codeValue) != 0 ||
                    !envelope.TryGetValue("data", out dataValue))
                {
                    return false;
                }
                Dictionary<string, object> data = dataValue as Dictionary<string, object>;
                object downloadDirValue;
                return data != null &&
                    data.TryGetValue("downloadDir", out downloadDirValue) &&
                    !String.IsNullOrWhiteSpace(Convert.ToString(downloadDirValue));
            }
        }
        catch (WebException error)
        {
            HttpWebResponse response = error.Response as HttpWebResponse;
            if (response == null) return false;
            using (response)
            {
                // The listener was already tied to the bundled Gopeed process
                // and a loopback-only port. An auth challenge proves its REST
                // server is alive; the extension will retry with its token.
                return response.StatusCode == HttpStatusCode.Unauthorized;
            }
        }
        catch
        {
            return false;
        }
    }

    private static Dictionary<string, object> ReadMessage()
    {
        Stream input = Console.OpenStandardInput();
        byte[] lengthBytes = ReadExactly(input, 4);
        if (lengthBytes == null) return null;
        int length = BitConverter.ToInt32(lengthBytes, 0);
        if (length <= 0 || length > MaxMessageBytes)
        {
            throw new InvalidDataException("本机消息长度不正确");
        }
        byte[] payload = ReadExactly(input, length);
        if (payload == null) throw new EndOfStreamException("本机消息未完整接收");
        string json = Encoding.UTF8.GetString(payload);
        return Json.Deserialize<Dictionary<string, object>>(json);
    }

    private static byte[] ReadExactly(Stream stream, int length)
    {
        byte[] buffer = new byte[length];
        int offset = 0;
        while (offset < length)
        {
            int count = stream.Read(buffer, offset, length - offset);
            if (count <= 0) return offset == 0 ? null : buffer;
            offset += count;
        }
        return buffer;
    }

    private static void WriteMessage(object value)
    {
        byte[] payload = Encoding.UTF8.GetBytes(Json.Serialize(value));
        byte[] length = BitConverter.GetBytes(payload.Length);
        Stream output = Console.OpenStandardOutput();
        output.Write(length, 0, length.Length);
        output.Write(payload, 0, payload.Length);
        output.Flush();
    }

    private static string GetString(Dictionary<string, object> value, string key)
    {
        object result;
        return value != null && value.TryGetValue(key, out result) && result != null
            ? Convert.ToString(result)
            : "";
    }

    private static int GetInteger(Dictionary<string, object> value, string key)
    {
        object result;
        int parsed;
        return value != null && value.TryGetValue(key, out result) && result != null &&
            Int32.TryParse(Convert.ToString(result), out parsed)
            ? parsed
            : 0;
    }

    private static long GetLong(Dictionary<string, object> value, string key)
    {
        object result;
        long parsed;
        return value != null && value.TryGetValue(key, out result) && result != null &&
            Int64.TryParse(Convert.ToString(result), out parsed)
            ? parsed
            : 0;
    }
}
