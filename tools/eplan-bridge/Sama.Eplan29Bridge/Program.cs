using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace Sama.Eplan29Bridge
{
    internal static class Program
    {
        internal static readonly Dictionary<string, string[]> RequiredDllVariants = new Dictionary<string, string[]>(StringComparer.OrdinalIgnoreCase)
        {
            { "Eplan.EplApi.Base", new[] { "Eplan.EplApi.Base.dll", "Eplan.EplApi.Baseu.dll" } },
            { "Eplan.EplApi.DataModel", new[] { "Eplan.EplApi.DataModel.dll", "Eplan.EplApi.DataModelu.dll" } },
            { "Eplan.EplApi.System", new[] { "Eplan.EplApi.System.dll", "Eplan.EplApi.Systemu.dll" } },
        };

        internal static readonly string[] ConflictProcessNames = { "W3u", "EPLAN", "Eplan", "EplanElectricP8" };

        [STAThread]
        static int Main(string[] args)
        {
            try
            {
                var opts = Options.Parse(args);
                if (string.IsNullOrWhiteSpace(opts.EplanExe))
                {
                    Console.Error.WriteLine("missing --eplan");
                    return 1;
                }

                opts.EplanExe = Path.GetFullPath(opts.EplanExe);
                if (!File.Exists(opts.EplanExe))
                {
                    Console.Error.WriteLine("eplan exe not found: " + opts.EplanExe);
                    return 1;
                }

                var conflicts = EplanPreflight.FindConflicts();
                if (opts.KillEplan && conflicts.Count > 0)
                {
                    var killed = EplanPreflight.KillConflicts(conflicts);
                    Console.WriteLine("killedProcesses=" + string.Join(",", killed));
                    Thread.Sleep(2000);
                    conflicts = EplanPreflight.FindConflicts();
                }
                if (conflicts.Count > 0 && !opts.Probe)
                {
                    Console.Error.WriteLine("eplanProcesses=" + string.Join(",", conflicts));
                    if (!opts.Force)
                    {
                        Console.Error.WriteLine("hint=请先关闭 EPLAN/W3u，或加 --kill-eplan 自动结束冲突进程");
                        return 10;
                    }
                }

                var api = ApiProbe.Find(opts.EplanExe);
                if (opts.Probe)
                {
                    Console.WriteLine(api.Ready ? "API_READY true" : "API_READY false");
                    Console.WriteLine("apiReady=" + (api.Ready ? "true" : "false"));
                    Console.WriteLine("platformBin=" + api.PlatformBin);
                    if (!api.Ready)
                        Console.WriteLine("missing=" + string.Join(",", api.Missing));
                    Environment.Exit(api.Ready ? 0 : 2);
                }

                if (opts.InvokeSmoke)
                {
                    if (!api.Ready)
                    {
                        Console.Error.WriteLine("api not ready");
                        return 3;
                    }
                    var smoke = TryInvokeSmoke(api, opts);
                    Console.WriteLine("invokeOk=" + (smoke.Ok ? "true" : "false"));
                    Console.Write(smoke.Log);
                    return smoke.Ok ? 0 : 5;
                }

                if (!opts.NewProjectOnly)
                {
                    Console.Error.WriteLine("only --new-project-only / --invoke-smoke / --probe supported");
                    return 1;
                }

                if (string.IsNullOrWhiteSpace(opts.Input) || !File.Exists(opts.Input))
                {
                    Console.Error.WriteLine("input missing: " + opts.Input);
                    return 1;
                }

                Directory.CreateDirectory(opts.Output);

                var manifest = new StringBuilder();
                manifest.AppendLine("SAMA EPLAN Bridge run");
                manifest.AppendLine("eplan=" + opts.EplanExe);
                manifest.AppendLine("platformBin=" + api.PlatformBin);
                manifest.AppendLine("apiReady=" + api.Ready);
                manifest.AppendLine("missing=" + string.Join(",", api.Missing));

                var destInput = Path.Combine(opts.Output, Path.GetFileName(opts.Input));
                if (!string.Equals(Path.GetFullPath(opts.Input), Path.GetFullPath(destInput), StringComparison.OrdinalIgnoreCase))
                    File.Copy(opts.Input, destInput, true);
                WriteProjectCheck(opts.Output, api, false, "task-pack", null);

                if (!api.Ready)
                {
                    WriteApiInstallNote(opts.Output, api.Missing);
                    Console.Error.WriteLine("EPLAN API not ready");
                    return 3;
                }

                var created = TryCreateProject(api, opts);
                WriteProjectCheck(opts.Output, api, created.Ok, created.Ok ? "official-api" : "bridge-pack", created.Runtime);
                File.WriteAllText(Path.Combine(opts.Output, "bridge-run.log"), manifest + created.Log, Encoding.UTF8);
                return created.Ok ? 0 : 4;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine(ex);
                Environment.Exit(99);
            }
            return 0;
        }

        private static CreateResult TryInvokeSmoke(ApiProbe api, Options opts)
        {
            var log = new StringBuilder();
            try
            {
                var app = PrepareEplApplication(api, opts, log);
                if (app == null) return new CreateResult(false, log.ToString(), null);

                log.AppendLine("Init completed");
                LogRuntimeInfo(app, log);

                try { app.Exit(); } catch (Exception ex) { log.AppendLine("Exit-fail=" + ex.Message); }
                return new CreateResult(true, log.ToString(), BuildRuntimeInfo(app));
            }
            catch (Exception ex)
            {
                log.AppendLine("error=" + ex);
                return new CreateResult(false, log.ToString(), null);
            }
        }

        private static CreateResult TryCreateProject(ApiProbe api, Options opts)
        {
            var log = new StringBuilder();
            try
            {
                var app = PrepareEplApplication(api, opts, log);
                if (app == null) return new CreateResult(false, log.ToString(), null);

                var pmType = api.FindType("Eplan.EplApi.DataModel.ProjectManager");
                if (pmType == null)
                {
                    log.AppendLine("ProjectManager type not found");
                    return new CreateResult(false, log.ToString(), null);
                }

                dynamic pm = Activator.CreateInstance(pmType);
                var projectName = "SAMA_" + DateTime.Now.ToString("yyyyMMdd_HHmmss");
                var projectPath = Path.Combine(opts.Output, projectName);
                Directory.CreateDirectory(projectPath);

                dynamic project = pm.CreateProject(projectPath, "EPLAN500");
                log.AppendLine("project=" + projectPath);

                try
                {
                    dynamic backup = project.BackupProject();
                    log.AppendLine("backup=" + backup);
                }
                catch (Exception ex)
                {
                    log.AppendLine("backup-fail=" + ex.Message);
                }

                var runtime = BuildRuntimeInfo(app);
                try { app.Exit(); } catch { /* ignore */ }
                return new CreateResult(true, log.ToString(), runtime);
            }
            catch (Exception ex)
            {
                log.AppendLine("error=" + ex);
                return new CreateResult(false, log.ToString(), null);
            }
        }

        private static dynamic PrepareEplApplication(ApiProbe api, Options opts, StringBuilder log)
        {
            if (!string.IsNullOrEmpty(api.PlatformBin) && Directory.Exists(api.PlatformBin))
            {
                Environment.CurrentDirectory = api.PlatformBin;
                log.AppendLine("platformBin=" + api.PlatformBin);
            }

            var appType = api.FindType("Eplan.EplApi.System.EplApplication")
                ?? api.FindType("Eplan.EplApi.ApplicationFramework.EplApplication");
            if (appType == null)
            {
                log.AppendLine("EplApplication type not found");
                return null;
            }
            log.AppendLine("EplApplication=" + appType.FullName);

            dynamic app = Activator.CreateInstance(appType);
            var eplanBinFolder = Path.GetDirectoryName(opts.EplanExe);
            if (string.IsNullOrEmpty(eplanBinFolder))
                eplanBinFolder = opts.EplanExe;
            app.EplanBinFolder = eplanBinFolder;
            log.AppendLine("EplanBinFolder=" + eplanBinFolder);

            var quietEnum = appType.GetNestedType("QuietModes");
            if (quietEnum != null)
            {
                var quietVal = Enum.Parse(quietEnum, "ShowNoDialogs");
                var quietProp = appType.GetProperty("QuietMode");
                if (quietProp != null)
                    quietProp.SetValue(app, quietVal);
                log.AppendLine("QuietMode=ShowNoDialogs");
            }

            // 不强制 lservrc：与 EPLAN 界面一致，走 softlock（lit/lir）或默认许可链
            var lservrc = @"C:\Users\Public\EPLAN\Common\lservrc";
            var softLit = @"C:\ProgramData\EPLAN\Common\EplanCommon.lit";
            var useLservrc = File.Exists(lservrc)
                && (string.Equals(Environment.GetEnvironmentVariable("SAMA_EPLAN_USE_LSERVRC"), "1", StringComparison.OrdinalIgnoreCase)
                    || !File.Exists(softLit));
            if (useLservrc)
            {
                try
                {
                    app.LicenseFile = lservrc;
                    log.AppendLine("LicenseFile=" + lservrc);
                }
                catch (Exception ex)
                {
                    log.AppendLine("LicenseFile-skip=" + ex.Message);
                }
            }
            else if (File.Exists(softLit))
            {
                log.AppendLine("licenseSource=softlock lit/lir (no LicenseFile override)");
            }

            try
            {
                app.InitGuiLanguage("zh_CN");
                log.AppendLine("InitGuiLanguage=zh_CN");
            }
            catch (Exception ex)
            {
                log.AppendLine("InitGuiLanguage-skip=" + ex.Message);
            }

            log.AppendLine("calling Init...");
            try
            {
                app.Init("");
                log.AppendLine("Init completed");
            }
            catch (Exception ex)
            {
                log.AppendLine("Init-error=" + ex);
                return null;
            }
            return app;
        }

        private static bool RunInitWithMessagePump_UNUSED(dynamic app, StringBuilder log, int timeoutMs)
        {
            Exception initError = null;
            var initOk = false;
            var thread = new Thread(() =>
            {
                try
                {
                    app.Init("");
                    initOk = true;
                }
                catch (Exception ex)
                {
                    initError = ex;
                }
            });
            thread.SetApartmentState(ApartmentState.STA);
            thread.IsBackground = true;
            thread.Start();

            var sw = Stopwatch.StartNew();
            while (!initOk && initError == null && sw.ElapsedMilliseconds < timeoutMs)
            {
                try { Application.DoEvents(); } catch { /* ignore */ }
                Thread.Sleep(50);
                if (!thread.IsAlive && !initOk) break;
            }

            if (initError != null)
            {
                log.AppendLine("Init-error=" + initError);
                return false;
            }
            if (!initOk)
            {
                log.AppendLine("Init-timeout=" + timeoutMs + "ms");
                try { thread.Abort(); } catch { /* ignore */ }
                return false;
            }
            return true;
        }

        private static void LogRuntimeInfo(dynamic app, StringBuilder log)
        {
            try { log.AppendLine("license=" + app.License); } catch { }
            try { log.AppendLine("variant=" + app.Variant); } catch { }
            try { log.AppendLine("version=" + app.Version); } catch { }
            try { log.AppendLine("offline=" + app.InOfflineMode); } catch { }
        }

        private static Dictionary<string, string> BuildRuntimeInfo(dynamic app)
        {
            var d = new Dictionary<string, string>();
            try { d["license"] = Convert.ToString(app.License); } catch { }
            try { d["variant"] = Convert.ToString(app.Variant); } catch { }
            try { d["version"] = Convert.ToString(app.Version); } catch { }
            try { d["offline"] = Convert.ToString(app.InOfflineMode); } catch { }
            return d;
        }

        private static void WriteApiInstallNote(string output, List<string> missing)
        {
            File.WriteAllText(
                Path.Combine(output, "EPLAN_API_安装说明.txt"),
                "未检测到 EPLAN API DLL。请安装 EPLAN Electric P8 API / Openness，然后运行 scripts/build-eplan-bridge.ps1 重新编译桥接。\r\n" +
                "缺少: " + string.Join(", ", missing),
                Encoding.UTF8);
        }

        private static void WriteProjectCheck(string output, ApiProbe api, bool ok, string mode, Dictionary<string, string> runtime)
        {
            var runtimeJson = runtime == null ? "null" : "{" + string.Join(",", runtime.Select(kv => "\"" + kv.Key + "\":\"" + kv.Value.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"")) + "}";
            var json = "{\r\n  \"ok\": " + (ok ? "true" : "false") +
                       ",\r\n  \"mode\": \"" + mode + "\"" +
                       ",\r\n  \"apiReady\": " + (api.Ready ? "true" : "false") +
                       ",\r\n  \"platformBin\": \"" + (api.PlatformBin ?? "").Replace("\\", "\\\\") + "\"" +
                       ",\r\n  \"runtime\": " + runtimeJson +
                       ",\r\n  \"missingDll\": [\"" + string.Join("\",\"", api.Missing) + "\"]\r\n}";
            File.WriteAllText(Path.Combine(output, "project-check.json"), json, Encoding.UTF8);
        }

        private struct CreateResult
        {
            public bool Ok;
            public string Log;
            public Dictionary<string, string> Runtime;
            public CreateResult(bool ok, string log, Dictionary<string, string> runtime)
            {
                Ok = ok;
                Log = log;
                Runtime = runtime;
            }
        }
    }

    internal static class EplanPreflight
    {
        public static List<string> FindConflicts()
        {
            var found = new List<string>();
            foreach (var name in Program.ConflictProcessNames)
            {
                try
                {
                    foreach (var p in Process.GetProcessesByName(name))
                    {
                        if (p.Id == Process.GetCurrentProcess().Id) continue;
                        found.Add(name + ":" + p.Id);
                    }
                }
                catch { /* ignore */ }
            }
            return found;
        }

        public static List<string> KillConflicts(List<string> conflicts)
        {
            var killed = new List<string>();
            foreach (var item in conflicts)
            {
                var idPart = item.Split(':').LastOrDefault();
                if (!int.TryParse(idPart, out var pid)) continue;
                try
                {
                    var p = Process.GetProcessById(pid);
                    p.Kill();
                    killed.Add(item);
                }
                catch { /* ignore */ }
            }
            return killed;
        }
    }

    internal sealed class Options
    {
        public string EplanExe { get; set; }
        public string Input { get; set; }
        public string Output { get; set; }
        public bool Probe { get; set; }
        public bool NewProjectOnly { get; set; }
        public bool InvokeSmoke { get; set; }
        public bool KillEplan { get; set; }
        public bool Force { get; set; }

        public static Options Parse(string[] args)
        {
            var o = new Options();
            for (int i = 0; i < args.Length; i++)
            {
                var a = args[i];
                if (a == "--probe") o.Probe = true;
                else if (a == "--new-project-only") o.NewProjectOnly = true;
                else if (a == "--invoke-smoke") o.InvokeSmoke = true;
                else if (a == "--kill-eplan") o.KillEplan = true;
                else if (a == "--force") o.Force = true;
                else if (a == "--eplan" && i + 1 < args.Length) o.EplanExe = args[++i];
                else if (a == "--input" && i + 1 < args.Length) o.Input = args[++i];
                else if (a == "--output" && i + 1 < args.Length) o.Output = args[++i];
            }
            if (string.IsNullOrWhiteSpace(o.Output)) o.Output = Directory.GetCurrentDirectory();
            return o;
        }
    }

    internal sealed class ApiProbe
    {
        public bool Ready { get; private set; }
        public List<string> Missing { get; private set; }
        public Dictionary<string, Assembly> Assemblies { get; private set; }
        public string PlatformBin { get; private set; }

        private ApiProbe()
        {
            Missing = new List<string>();
            Assemblies = new Dictionary<string, Assembly>(StringComparer.OrdinalIgnoreCase);
        }

        public Type FindType(string fullName)
        {
            foreach (var asm in Assemblies.Values)
            {
                try
                {
                    var t = asm.GetType(fullName, false);
                    if (t != null) return t;
                }
                catch { /* ignore */ }
            }
            return null;
        }

        public static ApiProbe Find(string eplanExe)
        {
            var probe = new ApiProbe();
            var roots = BuildSearchRoots(eplanExe);
            probe.PlatformBin = ResolvePlatformBin(eplanExe, roots);
            if (!string.IsNullOrEmpty(probe.PlatformBin) && Directory.Exists(probe.PlatformBin))
                Environment.CurrentDirectory = probe.PlatformBin;

            foreach (var pair in Program.RequiredDllVariants)
            {
                var logicalKey = pair.Key;
                var dllPath = FindDll(roots, pair.Value);
                if (string.IsNullOrEmpty(dllPath) && !string.IsNullOrEmpty(probe.PlatformBin))
                    dllPath = FindDll(new List<string> { probe.PlatformBin }, pair.Value);
                if (string.IsNullOrEmpty(dllPath))
                {
                    probe.Missing.Add(logicalKey + ".dll");
                    continue;
                }
                try
                {
                    probe.Assemblies[logicalKey] = Assembly.LoadFrom(dllPath);
                }
                catch
                {
                    probe.Missing.Add(logicalKey + ".dll");
                }
            }

            probe.Ready = probe.Missing.Count == 0;
            return probe;
        }

        private static string ResolvePlatformBin(string eplanExe, List<string> roots)
        {
            var version = DetectVersionFromPath(Path.GetFullPath(eplanExe));
            if (!string.IsNullOrEmpty(version))
            {
                foreach (var root in new[]
                {
                    @"D:\Program Files\EPLAN",
                    @"C:\Program Files\EPLAN",
                    @"C:\Program Files (x86)\EPLAN",
                })
                {
                    var bin = Path.Combine(root, "Platform", version, "Bin");
                    if (Directory.Exists(bin)) return bin;
                }
            }
            foreach (var root in roots)
            {
                if (string.IsNullOrEmpty(root) || !Directory.Exists(root)) continue;
                if (root.EndsWith("Bin", StringComparison.OrdinalIgnoreCase) && File.Exists(Path.Combine(root, "Eplan.EplApi.Baseu.dll")))
                    return root;
            }
            return null;
        }

        private static List<string> BuildSearchRoots(string eplanExe)
        {
            var roots = new List<string>();
            var fullExe = Path.GetFullPath(eplanExe);
            var exeDir = Path.GetDirectoryName(fullExe);
            if (!string.IsNullOrEmpty(exeDir))
            {
                roots.Add(exeDir);
                var parent = Path.GetDirectoryName(exeDir);
                if (!string.IsNullOrEmpty(parent))
                {
                    roots.Add(parent);
                    roots.Add(Path.Combine(parent, "Bin"));
                    roots.Add(Path.Combine(parent, "API"));
                }
                var version = DetectVersionFromPath(fullExe);
                if (!string.IsNullOrEmpty(version))
                {
                    roots.Add(Path.Combine(@"D:\Program Files\EPLAN", "Platform", version, "Bin"));
                    roots.Add(Path.Combine(@"C:\Program Files\EPLAN", "Platform", version, "Bin"));
                    roots.Add(Path.Combine(@"D:\Program Files (x86)\EPLAN", "Platform", version, "Bin"));
                }
            }
            roots.Add(@"D:\Program Files\EPLAN");
            roots.Add(@"C:\Program Files\EPLAN");
            roots.Add(@"C:\Program Files (x86)\EPLAN");
            return roots.Distinct().Where(r => !string.IsNullOrEmpty(r)).ToList();
        }

        private static string DetectVersionFromPath(string fullPath)
        {
            var parts = fullPath.Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            for (int i = 0; i < parts.Length; i++)
            {
                if (System.Text.RegularExpressions.Regex.IsMatch(parts[i], @"^\d+\.\d+(\.\d+)?$"))
                    return parts[i];
            }
            return null;
        }

        private static string FindDll(List<string> roots, string[] names)
        {
            foreach (var name in names)
            {
                foreach (var root in roots)
                {
                    if (string.IsNullOrEmpty(root) || !Directory.Exists(root)) continue;
                    try
                    {
                        foreach (var file in Directory.EnumerateFiles(root, name, SearchOption.TopDirectoryOnly))
                            return file;
                        foreach (var file in Directory.EnumerateFiles(root, name, SearchOption.AllDirectories))
                        {
                            if (file.IndexOf("\\Windows\\", StringComparison.OrdinalIgnoreCase) >= 0) continue;
                            if (file.IndexOf("\\zh-CN\\", StringComparison.OrdinalIgnoreCase) >= 0) continue;
                            return file;
                        }
                    }
                    catch { /* ignore */ }
                }
            }
            return null;
        }
    }
}
