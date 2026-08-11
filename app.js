(function () {
  "use strict";

  // ---------------------------------------------------------------------------
  // Supabase client
  // ---------------------------------------------------------------------------
  var cfg = window.SUPABASE_CONFIG || {};
  if (!cfg.url || cfg.url.indexOf("YOUR-PROJECT") !== -1) {
    alert(
      "Supabase is not configured yet.\n\nOpen config.js and fill in your " +
        "Project URL and anon/publishable key (see README.md)."
    );
  }
  var sb = window.supabase.createClient(cfg.url, cfg.anonKey);

  // ---------------------------------------------------------------------------
  // Element refs
  // ---------------------------------------------------------------------------
  var $ = function (id) { return document.getElementById(id); };

  var authView = $("auth-view");
  var appView = $("app-view");
  var userArea = $("user-area");
  var userEmail = $("user-email");
  var toggleSidebarBtn = $("toggle-sidebar");
  var chatToggle = $("chat-toggle");
  var chatPanel = $("chat-panel");
  var chatClose = $("chat-close");
  var chatSettings = $("chat-settings");
  var chatExpand = $("chat-expand");
  var chatWelcome = $("chat-welcome");
  var chatWelcomeOk = $("chat-welcome-ok");
  var chatKeySetup = $("chat-key-setup");
  var chatProvider = $("chat-provider");
  var chatSetupHint = $("chat-setup-hint");
  var chatConversation = $("chat-conversation");
  var chatInputRow = $("chat-input-row");
  var chatKeyInput = $("chat-key-input");
  var chatSavedKeysContainer = $("chat-saved-keys-container");
  var chatSavedKeysList = $("chat-saved-keys-list");
  var chatKeySave = $("chat-key-save");
  var chatInput = $("chat-input");
  var chatSend = $("chat-send");
  var chatAttachBtn = $("chat-attach");
  var chatImageInput = $("chat-image-input");
  var chatAttachments = $("chat-attachments");
  var chatModelBar = $("chat-model-bar");
  var chatModelCurrent = $("chat-model-current");
  var chatModelList = $("chat-model-list");
  var chatNew = $("chat-new");
  var chatHistoryBtn = $("chat-history");
  var chatHistoryView = $("chat-history-view");
  var chatHistoryList = $("chat-history-list");
  var chatHistoryEmpty = $("chat-history-empty");

  var authForm = $("auth-form");
  var authTitle = $("auth-title");
  var authEmail = $("auth-email");
  var authPassword = $("auth-password");
  var authSubmit = $("auth-submit");
  var authMessage = $("auth-message");
  var authToggleText = $("auth-toggle-text");
  var authToggleLink = $("auth-toggle-link");

  var signOutBtn = $("sign-out");
  var signInBtn = $("sign-in");
  var authGuestLink = $("auth-guest-link");

  var newProjectBtn = $("new-project");
  var projectList = $("project-list");
  var projectsEmpty = $("projects-empty");

  var filesSection = $("files-section");
  var projectNameInput = $("project-name");
  var deleteProjectBtn = $("delete-project");
  var newFileBtn = $("new-file");
  var detectTopBtn = $("detect-top");
  var importFileBtn = $("import-file");
  var importInput = $("import-input");
  var fileList = $("file-list");
  var filesEmpty = $("files-empty");

  var noSelection = $("no-selection");
  var editorPanel = $("editor-panel");
  var fileNameInput = $("file-name");
  var saveBtn = $("save-file");
  var delModal = $("del-modal");
  var delModalText = $("del-modal-text");
  var delCancelBtn = $("del-cancel");
  var delDontAskBtn = $("del-dontask");
  var delConfirmBtn = $("del-confirm");
  var fileMenu = $("file-menu");
  var fileMenuDelete = $("file-menu-delete");
  var githubPushBtn = $("github-push");
  var ghModal = $("gh-modal");
  var ghRepoSelect = $("gh-repo-select");
  var ghNewNameField = $("gh-newname-field");
  var ghNewName = $("gh-new-name");
  var ghPrivateField = $("gh-private-field");
  var ghPrivate = $("gh-private");
  var ghCancelBtn = $("gh-cancel");
  var ghConfirmBtn = $("gh-confirm");
  var exportBtn = $("export-btn");
  var exportModal = $("export-modal");
  var exportFileBtn = $("export-file");
  var exportProjectBtn = $("export-project");
  var exportCancelBtn = $("export-cancel");
  var viewDiagramBtn = $("view-diagram");
  var editorEl = $("editor");
  var diagramView = $("diagram-view");
  var diagramBody = $("diagram-body");
  var diagramClose = $("diagram-close");
  var useSpecBtn = $("use-spec-btn");
  var syncBtn = $("sync-btn");
  var moreBtn = $("more-btn");
  var moreMenu = $("more-menu");
  var generateTbBtn = $("generate-tb");
  var runSimBtn = $("run-sim");
  var synthProjectBtn = $("synth-project");
  var clearBtn = $("clear-output");
  var outputPanel = $("output");
  var outputBody = $("output-body");

  var consoleToggle = $("console-toggle");
  var consolePanel = $("console-panel");
  var consoleBody = $("console-body");
  var consoleHeader = $("console-header");
  var consoleClearBtn = $("console-clear");
  var consoleCloseBtn = $("console-close");
  var consoleConfigBtn = $("console-config");

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  var editor = null;
  var projects = [];        // [{id, name}]
  var files = [];           // files of the open project: [{id, name, code}]
  var currentProjectId = null;
  var currentFileId = null;
  var authMode = "signin";

  var STARTER_CODE = [
    "module counter (",
    "    input  wire clk,",
    "    input  wire rst_n,",
    "    output reg  [7:0] count",
    ");",
    "",
    "    always @(posedge clk or negedge rst_n) begin",
    "        if (!rst_n)",
    "            count <= 8'd0;",
    "        else",
    "            count <= count + 1'b1;",
    "    end",
    "",
    "endmodule",
  ].join("\n");

  // ---------------------------------------------------------------------------
  // Storage layer — Supabase when signed in, browser localStorage when a guest.
  // Sign-in is OPTIONAL: guests can use everything; their work is saved locally
  // (this browser only). Signing in saves to the cloud account instead.
  // Every method resolves to { data, error } to match Supabase's shape.
  // ---------------------------------------------------------------------------
  var GUEST = true; // flipped to false once a session is present
  function newId() {
    return (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : "g-" + Date.now().toString(36) + Math.random().toString(16).slice(2, 8);
  }
  function lsGet(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { localStorage.setItem(k, JSON.stringify(v)); }
  var GK_PROJECTS = "guest_projects";
  var GK_CONVOS = "guest_conversations";
  function gkFiles(pid) { return "guest_files_" + pid; }
  function nowISO() { return new Date().toISOString(); }
  // Find a guest file by id across all guest projects → { key, arr, idx } or null.
  function guestFindFile(id) {
    var ps = lsGet(GK_PROJECTS, []);
    for (var i = 0; i < ps.length; i++) {
      var key = gkFiles(ps[i].id);
      var arr = lsGet(key, []);
      var idx = arr.findIndex(function (f) { return f.id === id; });
      if (idx >= 0) return { key: key, arr: arr, idx: idx };
    }
    return null;
  }

  // --- Projects ---
  async function dbListProjects() {
    if (GUEST) {
      var ps = lsGet(GK_PROJECTS, []).slice();
      ps.sort(function (a, b) { return String(b.updated_at || "").localeCompare(String(a.updated_at || "")); });
      return { data: ps, error: null };
    }
    return await sb.from("projects").select("id, name, updated_at").order("updated_at", { ascending: false });
  }
  async function dbCreateProject(name) {
    if (GUEST) {
      var p = { id: newId(), name: name, updated_at: nowISO() };
      var ps = lsGet(GK_PROJECTS, []); ps.unshift(p); lsSet(GK_PROJECTS, ps);
      lsSet(gkFiles(p.id), []);
      return { data: p, error: null };
    }
    return await sb.from("projects").insert({ name: name }).select("id, name, updated_at").single();
  }
  async function dbRenameProject(id, name) {
    if (GUEST) {
      var ps = lsGet(GK_PROJECTS, []); var p = ps.find(function (x) { return x.id === id; });
      if (p) { p.name = name; p.updated_at = nowISO(); lsSet(GK_PROJECTS, ps); }
      return { error: null };
    }
    return await sb.from("projects").update({ name: name }).eq("id", id);
  }
  async function dbDeleteProject(id) {
    if (GUEST) {
      lsSet(GK_PROJECTS, lsGet(GK_PROJECTS, []).filter(function (x) { return x.id !== id; }));
      localStorage.removeItem(gkFiles(id));
      return { error: null };
    }
    return await sb.from("projects").delete().eq("id", id);
  }

  // --- Files ---
  async function dbListFiles(pid) {
    if (GUEST) {
      var arr = lsGet(gkFiles(pid), []).slice();
      arr.sort(function (a, b) { return String(a.name || "").localeCompare(String(b.name || "")); });
      return { data: arr, error: null };
    }
    return await sb.from("files").select("id, name, code").eq("project_id", pid).order("name", { ascending: true });
  }
  async function dbCreateFile(pid, name, code) {
    if (GUEST) {
      var f = { id: newId(), name: name, code: code || "" };
      var arr = lsGet(gkFiles(pid), []); arr.push(f); lsSet(gkFiles(pid), arr);
      return { data: f, error: null };
    }
    return await sb.from("files").insert({ project_id: pid, name: name, code: code }).select("id, name, code").single();
  }
  async function dbUpdateFile(id, fields) {
    if (GUEST) {
      var loc = guestFindFile(id);
      if (!loc) return { data: null, error: { message: "file not found" } };
      Object.assign(loc.arr[loc.idx], fields);
      lsSet(loc.key, loc.arr);
      return { data: loc.arr[loc.idx], error: null };
    }
    return await sb.from("files").update(fields).eq("id", id).select("id, name, code").single();
  }
  async function dbDeleteFile(id) {
    if (GUEST) {
      var loc = guestFindFile(id);
      if (loc) { loc.arr.splice(loc.idx, 1); lsSet(loc.key, loc.arr); }
      return { error: null };
    }
    return await sb.from("files").delete().eq("id", id);
  }

  // --- Conversations (chat history) ---
  async function dbListConversations() {
    if (GUEST) {
      var cs = lsGet(GK_CONVOS, []).map(function (c) { return { id: c.id, title: c.title, updated_at: c.updated_at }; });
      cs.sort(function (a, b) { return String(b.updated_at || "").localeCompare(String(a.updated_at || "")); });
      return { data: cs, error: null };
    }
    return await sb.from("conversations").select("id, title, updated_at").order("updated_at", { ascending: false });
  }
  async function dbGetConversation(id) {
    if (GUEST) {
      var c = lsGet(GK_CONVOS, []).find(function (x) { return x.id === id; });
      return { data: c ? { id: c.id, messages: c.messages } : null, error: c ? null : { message: "not found" } };
    }
    return await sb.from("conversations").select("id, messages").eq("id", id).single();
  }
  async function dbCreateConversation(rec) {
    if (GUEST) {
      var c = { id: newId(), title: rec.title, provider: rec.provider, model: rec.model, messages: rec.messages, updated_at: nowISO() };
      var cs = lsGet(GK_CONVOS, []); cs.unshift(c); lsSet(GK_CONVOS, cs);
      return { data: { id: c.id }, error: null };
    }
    return await sb.from("conversations").insert(rec).select("id").single();
  }
  async function dbUpdateConversation(id, fields) {
    if (GUEST) {
      var cs = lsGet(GK_CONVOS, []); var c = cs.find(function (x) { return x.id === id; });
      if (c) { Object.assign(c, fields); c.updated_at = nowISO(); lsSet(GK_CONVOS, cs); }
      return { error: null };
    }
    return await sb.from("conversations").update(fields).eq("id", id);
  }
  async function dbDeleteConversation(id) {
    if (GUEST) {
      lsSet(GK_CONVOS, lsGet(GK_CONVOS, []).filter(function (x) { return x.id !== id; }));
      return { error: null };
    }
    return await sb.from("conversations").delete().eq("id", id);
  }

  // ---------------------------------------------------------------------------
  // Editor
  // ---------------------------------------------------------------------------
  function initEditor() {
    if (editor) return;
    editor = ace.edit("editor");
    editor.setTheme("ace/theme/monokai");
    editor.session.setMode("ace/mode/verilog");
    editor.setOptions({
      fontSize: "14px",
      showPrintMargin: false,
      tabSize: 4,
      useSoftTabs: true,
    });
    if (window.mermaid) {
      try {
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "default" });
      } catch (e) { /* mermaid optional */ }
    }
    // Keep the 📊 Diagram and ▶ Run simulation buttons in sync as content changes.
    editor.on("change", updateDiagramButton);
    editor.on("change", updateRunSimButton);
  }

  // ---------------------------------------------------------------------------
  // Dependency diagram (Mermaid) — render ```mermaid blocks from the open file
  // ---------------------------------------------------------------------------
  var diagramSeq = 0;

  function extractMermaid(text) {
    var blocks = [];
    var re = /```mermaid\s*\r?\n([\s\S]*?)```/gi;
    var m;
    while ((m = re.exec(text || ""))) blocks.push(m[1].trim());
    return blocks;
  }

  function updateDiagramButton() {
    if (!viewDiagramBtn) return;
    var text = editor ? editor.getValue() : "";
    if (window.mermaid && extractMermaid(text).length) {
      viewDiagramBtn.classList.remove("hidden");
    } else {
      viewDiagramBtn.classList.add("hidden");
      hideDiagram();
    }
  }

  // Run simulation is available for any Verilog file — it compiles that file plus
  // the modules (in other files) it instantiates, transitively. Non-Verilog files
  // (.md etc.) aren't runnable → the button is grayed out.
  function updateRunSimButton() {
    if (!runSimBtn) return;
    var name = fileNameInput ? fileNameInput.value.trim() : "";
    var ok = currentFileId != null && isVerilogName(name);
    runSimBtn.disabled = !ok;
    runSimBtn.title = ok
      ? "Compile this file + the modules it uses (from other files) and run with vvp"
      : "Open a Verilog (.v/.sv) file to run it";
  }

  // Files needed to simulate the current file: itself, plus every file that
  // defines a module instantiated (transitively) by the included files. When a
  // module is defined in more than one file, prefer the current file, then RTL,
  // then synthesized netlists — and never include a file twice, so duplicate
  // module declarations (e.g. dot_product in both dot_product.v and netlist.v)
  // can't collide. Returns [{name, code}].
  function collectSimFiles(startName, startCode) {
    var strip = function (s) { return String(s || "").replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, ""); };
    var isNetlist = function (n) { return /(^|[_.])netlist\.v$/i.test(n) || /_(syn|gate|netlist)\.v$/i.test(n); };
    var vFiles = files.filter(function (f) { return isVerilogName(f.name); })
      .map(function (f) { return { name: f.name, code: f.name === startName ? startCode : (f.code || "") }; });
    var codeOf = {};
    vFiles.forEach(function (f) { codeOf[f.name] = f.code; });
    // Build moduleName -> defining file, preferring current > RTL > netlist.
    var order = vFiles.slice().sort(function (a, b) {
      var rank = function (n) { return n === startName ? 0 : isNetlist(n) ? 2 : 1; };
      return rank(a.name) - rank(b.name);
    });
    var defOf = {}, allNames = [];
    order.forEach(function (f) {
      var re = /\bmodule\s+(\w+)/g, m, s = strip(f.code);
      while ((m = re.exec(s))) {
        if (!(m[1] in defOf)) defOf[m[1]] = f.name;
        if (allNames.indexOf(m[1]) < 0) allNames.push(m[1]);
      }
    });
    var instIn = function (code) {
      var s = strip(code), out = [];
      allNames.forEach(function (n) {
        var rx = new RegExp("\\b" + n + "\\b\\s*(?:#\\s*\\([^)]*(?:\\([^)]*\\)[^)]*)*\\))?\\s*\\w+\\s*\\(");
        if (rx.test(s)) out.push(n);
      });
      return out;
    };
    var included = {}; included[startName] = codeOf[startName] != null ? codeOf[startName] : startCode;
    var stack = [startName];
    while (stack.length) {
      var fn = stack.pop();
      instIn(included[fn]).forEach(function (mn) {
        var df = defOf[mn];
        if (df && !(df in included)) { included[df] = codeOf[df] || ""; stack.push(df); }
      });
    }
    return Object.keys(included).map(function (fn) { return { name: fn, code: included[fn] }; });
  }

  function hideDiagram() {
    if (!diagramView) return;
    diagramView.classList.add("hidden");
    if (editorEl) editorEl.classList.remove("hidden");
    if (editor) editor.resize();
  }

  function showDiagram() {
    if (!diagramView || !window.mermaid) return;
    var blocks = extractMermaid(editor ? editor.getValue() : "");
    if (!blocks.length) return;
    if (editorEl) editorEl.classList.add("hidden");
    diagramView.classList.remove("hidden");
    diagramBody.textContent = "Rendering…";
    var rendered = [];
    var i = 0;
    function renderNext() {
      if (i >= blocks.length) {
        diagramBody.innerHTML = "";
        rendered.forEach(function (node) { diagramBody.appendChild(node); });
        return;
      }
      diagramSeq += 1;
      var id = "mmd-" + diagramSeq;
      mermaid
        .render(id, blocks[i])
        .then(function (res) {
          var wrap = document.createElement("div");
          wrap.className = "diagram-item";
          wrap.innerHTML = res.svg; // mermaid output, sanitized (securityLevel: strict)
          rendered.push(wrap);
          i += 1;
          renderNext();
        })
        .catch(function (err) {
          var pre = document.createElement("pre");
          pre.className = "diagram-error";
          pre.textContent =
            "Couldn't render this diagram:\n" +
            ((err && err.message) || String(err)) +
            "\n\n--- diagram source ---\n" +
            blocks[i];
          rendered.push(pre);
          i += 1;
          renderNext();
        });
    }
    renderNext();
  }

  // ---------------------------------------------------------------------------
  // Auth UI
  // ---------------------------------------------------------------------------
  function setAuthMessage(text, kind) {
    authMessage.textContent = text || "";
    authMessage.className = "auth-message" + (kind ? " " + kind : "");
  }

  function setAuthMode(mode) {
    authMode = mode;
    if (mode === "signup") {
      authTitle.textContent = "Create account";
      authSubmit.textContent = "Sign up";
      authToggleText.textContent = "Already have an account?";
      authToggleLink.textContent = "Sign in";
      authPassword.setAttribute("autocomplete", "new-password");
    } else {
      authTitle.textContent = "Sign in";
      authSubmit.textContent = "Sign in";
      authToggleText.textContent = "Don't have an account?";
      authToggleLink.textContent = "Sign up";
      authPassword.setAttribute("autocomplete", "current-password");
    }
    setAuthMessage("");
  }

  authToggleLink.addEventListener("click", function (e) {
    e.preventDefault();
    setAuthMode(authMode === "signin" ? "signup" : "signin");
  });

  authForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var email = authEmail.value.trim();
    var password = authPassword.value;
    if (!email || !password) return;

    authSubmit.disabled = true;
    setAuthMessage(authMode === "signup" ? "Creating account…" : "Signing in…", "info");

    var op =
      authMode === "signup"
        ? sb.auth.signUp({ email: email, password: password })
        : sb.auth.signInWithPassword({ email: email, password: password });

    op.then(function (res) {
      authSubmit.disabled = false;
      if (res.error) {
        setAuthMessage(res.error.message, "error");
        return;
      }
      if (authMode === "signup" && !res.data.session) {
        setAuthMessage(
          "Account created. Check your email to confirm, then sign in.",
          "success"
        );
        setAuthMode("signin");
        return;
      }
      // onAuthStateChange swaps to the app view.
    });
  });

  // ---------------------------------------------------------------------------
  // View switching
  // ---------------------------------------------------------------------------
  // Enter the app. session === null → GUEST mode (localStorage); a session → signed
  // in (cloud/Supabase). Sign-in is optional; guests can use everything.
  function enterApp(session) {
    GUEST = !session;
    authView.classList.add("hidden");
    appView.classList.remove("hidden");
    userArea.classList.remove("hidden");
    toggleSidebarBtn.classList.remove("hidden");
    document.body.classList.add("chat-docked");  // permanent right-side assistant
    chatToggle.classList.add("hidden");          // no launcher needed — always docked
    chatPanel.classList.remove("hidden");
    consolePanel.classList.remove("hidden"); // permanent bottom-docked console
    consoleToggle.classList.add("hidden");
    if (session) {
      userEmail.textContent = session.user.email;
      userEmail.classList.remove("hidden");
      signOutBtn.classList.remove("hidden");
      signInBtn.classList.add("hidden");
    } else {
      userEmail.textContent = "";
      userEmail.classList.add("hidden");
      signOutBtn.classList.add("hidden");
      signInBtn.classList.remove("hidden");
    }
    // Reset selection when switching between accounts / guest.
    projects = [];
    files = [];
    currentProjectId = null;
    currentFileId = null;
    filesSection.classList.add("hidden");
    closeEditorPanel();
    initEditor();
    loadProjects();
    loadConversations();
    renderChatView();
  }

  // Show the sign-in screen (from the "Sign in to save" button). Guest work in
  // localStorage is untouched; "Continue without signing in" returns to it.
  function openSignIn() {
    appView.classList.add("hidden");
    chatPanel.classList.add("hidden");
    consolePanel.classList.add("hidden");
    authView.classList.remove("hidden");
    authEmail.value = "";
    authPassword.value = "";
    setAuthMode("signin");
    setAuthMessage("");
  }

  // ---------------------------------------------------------------------------
  // Projects
  // ---------------------------------------------------------------------------
  function renderProjectList() {
    projectList.innerHTML = "";
    projectsEmpty.classList.toggle("hidden", projects.length > 0);
    projects.forEach(function (p) {
      var li = document.createElement("li");
      li.dataset.id = p.id;
      if (p.id === currentProjectId) li.classList.add("active");

      var icon = document.createElement("span");
      icon.className = "item-icon";
      icon.textContent = "📁";
      var label = document.createElement("span");
      label.className = "item-label";
      label.textContent = p.name || "Untitled";

      li.appendChild(icon);
      li.appendChild(label);
      li.addEventListener("click", function () { openProject(p.id); });
      projectList.appendChild(li);
    });
  }

  function loadProjects() {
    dbListProjects().then(function (res) {
      if (res.error) { alert("Could not load projects: " + res.error.message); return; }
      projects = res.data || [];
      renderProjectList();
    });
  }

  function openProject(id) {
    var p = projects.find(function (x) { return x.id === id; });
    if (!p) return;
    currentProjectId = id;
    currentFileId = null;
    projectNameInput.value = p.name || "";
    filesSection.classList.remove("hidden");
    renderProjectList();
    closeEditorPanel();
    loadFiles(id);
  }

  newProjectBtn.addEventListener("click", function () {
    newProjectBtn.disabled = true;
    dbCreateProject("Untitled project").then(function (res) {
      if (res.error) {
        newProjectBtn.disabled = false;
        alert("Could not create project: " + res.error.message);
        return;
      }
      var project = res.data;
      projects.unshift(project);
      // Seed the project with one starter file.
      return dbCreateFile(project.id, "top.v", STARTER_CODE).then(function (fres) {
        newProjectBtn.disabled = false;
        if (fres.error) { alert("Could not create file: " + fres.error.message); }
        currentProjectId = project.id;
        projectNameInput.value = project.name;
        filesSection.classList.remove("hidden");
        renderProjectList();
        files = fres.data ? [fres.data] : [];
        renderFileList();
        if (files.length) openFile(files[0].id);
      });
    });
  });

  // Rename project on edit.
  projectNameInput.addEventListener("change", function () {
    if (currentProjectId == null) return;
    var name = projectNameInput.value.trim() || "Untitled project";
    projectNameInput.value = name;
    dbRenameProject(currentProjectId, name).then(function (res) {
      if (res.error) { alert("Could not rename project: " + res.error.message); return; }
      var p = projects.find(function (x) { return x.id === currentProjectId; });
      if (p) p.name = name;
      renderProjectList();
    });
  });

  deleteProjectBtn.addEventListener("click", function () {
    if (currentProjectId == null) return;
    if (!confirm("Delete this project and ALL its files? This cannot be undone.")) return;
    var id = currentProjectId;
    dbDeleteProject(id).then(function (res) {
      if (res.error) { alert("Could not delete project: " + res.error.message); return; }
      projects = projects.filter(function (p) { return p.id !== id; });
      currentProjectId = null;
      currentFileId = null;
      files = [];
      filesSection.classList.add("hidden");
      closeEditorPanel();
      renderProjectList();
    });
  });

  // ---------------------------------------------------------------------------
  // Files
  // ---------------------------------------------------------------------------
  // --- Top-level module: user-declared > AI-declared > auto-guess ---
  function declaredTopKey() { return "top_" + currentProjectId; }
  function getDeclaredTop() {
    try { return JSON.parse(localStorage.getItem(declaredTopKey()) || "null"); }
    catch (e) { return null; }
  }
  function setDeclaredTop(fileId, source) {
    localStorage.setItem(declaredTopKey(), JSON.stringify({ id: fileId, source: source }));
  }
  function clearDeclaredTop() { localStorage.removeItem(declaredTopKey()); }

  // The current top: only an explicit declaration (by the user or the AI).
  // No free auto-guess — if nothing is declared, no file is marked.
  function resolveTop() {
    var d = getDeclaredTop();
    if (d && d.id && files.some(function (f) { return f.id === d.id; })) return d.id;
    return null;
  }
  // The MODULE name of the user-selected top file (for synthesis). Prefers the
  // module whose name matches the filename, else the file's first module.
  function selectedTopModule() {
    var topId = resolveTop();
    if (!topId) return "";
    var f = files.find(function (x) { return x.id === topId; });
    if (!f) return "";
    var names = [];
    var re = /\bmodule\s+(\w+)/g, m;
    while ((m = re.exec(f.code || ""))) names.push(m[1]);
    if (!names.length) return "";
    var base = (f.name || "").replace(/\.(v|sv|svh|vh)$/i, "");
    return names.indexOf(base) >= 0 ? base : names[0];
  }

  // The AI can declare the top via a "TOP: <filename>" line (won't override a
  // top the user set manually).
  function applyAiTopDeclaration(reply) {
    var m = /(^|\n)\s*TOP:\s*([^\n]+)/i.exec(reply || "");
    if (!m) return;
    var name = m[2].trim().replace(/[`*]/g, "");
    var f = files.find(function (x) { return (x.name || "") === name; });
    if (!f) return;
    var d = getDeclaredTop();
    if (d && d.source === "user") return; // keep the user's manual choice
    setDeclaredTop(f.id, "ai");
    renderFileList();
  }

  function renderFileList() {
    fileList.innerHTML = "";
    filesEmpty.classList.toggle("hidden", files.length > 0);
    var topId = resolveTop();
    // Show the declared top file first, then the rest alphabetically.
    var ordered = files.slice().sort(function (a, b) {
      if (a.id === topId) return -1;
      if (b.id === topId) return 1;
      return (a.name || "").localeCompare(b.name || "");
    });
    ordered.forEach(function (f) {
      var li = document.createElement("li");
      li.dataset.id = f.id;
      if (f.id === currentFileId) li.classList.add("active");

      var icon = document.createElement("span");
      icon.className = "item-icon";
      icon.textContent = "📄";
      var label = document.createElement("span");
      label.className = "item-label";
      label.textContent = f.name || "untitled.v";

      li.appendChild(icon);
      li.appendChild(label);

      if (topId && f.id === topId) {
        var badge = document.createElement("span");
        badge.className = "top-badge";
        badge.textContent = "TOP";
        badge.title = "Top-level module";
        li.appendChild(badge);
      }

      if (isSpec(f.id)) {
        var sbadge = document.createElement("span");
        sbadge.className = "spec-badge";
        sbadge.textContent = "SPEC";
        sbadge.title = "Design spec file";
        li.appendChild(sbadge);
      }

      if (isVerilogName(f.name)) {
        var declaredHere = topId === f.id;
        var star = document.createElement("button");
        star.className = "top-star";
        star.textContent = declaredHere ? "★" : "☆";
        star.title = declaredHere ? "Unset as top-level" : "Set as top-level";
        star.addEventListener("click", function (e) {
          e.stopPropagation();
          if (declaredHere) clearDeclaredTop();
          else setDeclaredTop(f.id, "user");
          renderFileList();
        });
        li.appendChild(star);
      }

      li.addEventListener("click", function () { openFile(f.id); });
      li.addEventListener("contextmenu", function (e) {
        e.preventDefault();
        showFileMenu(e, f.id);
      });
      fileList.appendChild(li);
    });
  }

  function loadFiles(projectId) {
    dbListFiles(projectId).then(function (res) {
        if (res.error) { alert("Could not load files: " + res.error.message); return; }
        files = res.data || [];
        renderFileList();
        renderAttachments(); // show any attached spec chips for this project
        if (files.length) {
          openFile(files[0].id);
        } else {
          closeEditorPanel();
        }
      });
  }

  // Pick an Ace syntax-highlighting mode from the file's extension.
  function modeForFile(name) {
    var n = (name || "").toLowerCase();
    var ext = n.indexOf(".") >= 0 ? n.split(".").pop() : n;
    var map = {
      v: "verilog", sv: "verilog", vh: "verilog", svh: "verilog",
      md: "markdown", markdown: "markdown",
      py: "python",
      js: "javascript", mjs: "javascript", ts: "typescript",
      json: "json",
      html: "html", htm: "html", css: "css",
      c: "c_cpp", h: "c_cpp", cpp: "c_cpp", cc: "c_cpp", hpp: "c_cpp",
      sh: "sh", bash: "sh",
      yml: "yaml", yaml: "yaml",
      xml: "xml", tcl: "tcl",
    };
    return "ace/mode/" + (map[ext] || "text");
  }

  function openFile(fileId) {
    var f = files.find(function (x) { return x.id === fileId; });
    if (!f) return;
    currentFileId = fileId;
    fileNameInput.value = f.name || "";
    editor.setValue(f.code || "", -1);
    editor.session.setMode(modeForFile(f.name));
    hideDiagram();
    updateDiagramButton();
    updateRunSimButton();
    updateSpecButton();
    openEditorPanel();
    renderFileList();
    clearOutput();
    editor.focus();
  }

  function isMarkdownName(name) { return /\.(md|markdown)$/i.test(name || ""); }

  // Which .md file is the designated design spec (per project).
  function specKey() { return "spec_" + currentProjectId; }
  function getSpecIds() {
    try { var a = JSON.parse(localStorage.getItem(specKey()) || "[]"); return Array.isArray(a) ? a : []; }
    catch (e) { return []; }
  }
  function setSpecIds(arr) { localStorage.setItem(specKey(), JSON.stringify(arr)); }
  function isSpec(id) { return getSpecIds().indexOf(id) !== -1; }
  function addSpec(id) { var a = getSpecIds(); if (a.indexOf(id) === -1) { a.push(id); setSpecIds(a); } }
  function removeSpec(id) { setSpecIds(getSpecIds().filter(function (x) { return x !== id; })); }

  // Show/disable the "Use as spec" button based on the open file.
  function updateSpecButton() {
    var hasSpec = getSpecIds().some(function (id) { return files.some(function (x) { return x.id === id; }); });
    // Sync-to-LLM button is always present; grayed out until a spec is selected.
    syncBtn.disabled = !hasSpec;
    syncBtn.title = hasSpec
      ? "Save and send all current project files to the AI"
      : "Add at least one spec first (open a .md file and click Use as spec)";
    // For an open .md: "Use as spec" (add) or "Remove spec" (if already one).
    var f = files.find(function (x) { return x.id === currentFileId; });
    if (f && isMarkdownName(f.name)) {
      useSpecBtn.classList.remove("hidden");
      var already = isSpec(f.id);
      useSpecBtn.textContent = already ? "Remove spec" : "Use as spec";
      useSpecBtn.title = already ? "Remove this file from the design specs" : "Add this Markdown file to the design specs";
    } else {
      useSpecBtn.classList.add("hidden");
    }
  }

  function uniqueFileName(base) {
    var name = base;
    var i = 1;
    var taken = function (n) {
      return files.some(function (f) { return f.name === n; });
    };
    while (taken(name)) {
      i += 1;
      name = base.replace(/(\.[^.]*)?$/, "-" + i + "$1");
    }
    return name;
  }

  newFileBtn.addEventListener("click", function () {
    if (currentProjectId == null) return;
    var input = prompt("New file name (include the extension, e.g. counter.v, spec.md, notes.txt):", "untitled.v");
    if (input == null) return;          // cancelled
    input = input.trim();
    if (!input) return;                 // empty
    var name = uniqueFileName(input);
    newFileBtn.disabled = true;
    dbCreateFile(currentProjectId, name, "").then(function (res) {
        newFileBtn.disabled = false;
        if (res.error) { alert("Could not create file: " + res.error.message); return; }
        files.push(res.data);
        files.sort(function (a, b) { return a.name.localeCompare(b.name); });
        renderFileList();
        openFile(res.data.id);
      });
  });

  // Send a spec file's contents to the LLM as the design prompt (no typing).
  // Attach a Markdown file to the chat as a spec (does NOT send). Its contents
  // ride along with the next prompt. Multiple specs can be attached at once.
  var SPEC_PROMPT = "This markdown file/files are my specs. Use them to build a project in Verilog.";
  function useAsSpec(file) {
    addSpec(file.id);
    renderChatView();      // show the conversation view + attachments strip
    renderAttachments();   // show the spec chip in the chatbox
    updateSpecButton();
    renderFileList();
    // Prefill the build prompt (don't clobber anything the user already typed).
    var typed = chatInput.value.trim();
    if (!typed || typed === SPEC_PROMPT) chatInput.value = SPEC_PROMPT;
    consoleLog("📎 attached spec to chat: " + file.name, "info");
  }

  // Import files from the user's computer into the current project.
  importFileBtn.addEventListener("click", function () {
    if (currentProjectId == null) { alert("Open a project first."); return; }
    importInput.value = ""; // reset so re-picking the same file still fires change
    importInput.click();
  });
  importInput.addEventListener("change", async function () {
    var picked = importInput.files;
    if (!picked || !picked.length || currentProjectId == null) return;
    importFileBtn.disabled = true;
    var firstId = null, imported = [];
    try {
      for (var i = 0; i < picked.length; i++) {
        var file = picked[i];
        var text = await file.text();
        var name = uniqueFileName(file.name || "untitled.txt");
        var res = await dbCreateFile(currentProjectId, name, text);
        if (!res.error) {
          files.push(res.data);
          imported.push(res.data);
          if (firstId == null) firstId = res.data.id;
          consoleLog("⬆ imported " + name, "ok");
        } else {
          consoleLog("✗ import failed: " + (file.name || "file") + " — " + res.error.message, "error");
        }
      }
      files.sort(function (a, b) { return (a.name || "").localeCompare(b.name || ""); });
      renderFileList();
      if (firstId != null) openFile(firstId);
      // Offer to use an imported Markdown file as the design spec.
      var md = imported.filter(function (f) { return /\.(md|markdown)$/i.test(f.name || ""); });
      if (md.length === 1 &&
          confirm("Attach \"" + md[0].name + "\" to the chat as a design spec? It'll be sent with your next prompt.")) {
        useAsSpec(md[0]);
      }
    } catch (err) {
      alert("Import failed: " + (err.message || err));
    } finally {
      importFileBtn.disabled = false;
    }
  });

  // Rename file when the name field changes.
  fileNameInput.addEventListener("change", function () {
    if (currentFileId == null) return;
    var name = fileNameInput.value.trim() || "untitled.v";
    fileNameInput.value = name;
    var f = files.find(function (x) { return x.id === currentFileId; });
    if (f) f.name = name;
    editor.session.setMode(modeForFile(name));
    updateSpecButton();
    renderFileList();
  });

  // Save every file in the project (captures the open file's editor edits too).
  async function saveAllFiles() {
    syncCurrentFileFromEditor();
    var saved = 0;
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      var res = await dbUpdateFile(f.id, { name: f.name, code: f.code });
      if (!res.error) saved++;
    }
    return saved;
  }

  // Save the whole project, then send all current files to the LLM.
  async function syncCurrentCode() {
    var provider = currentProvider();
    if (!getProviderKey(provider)) {
      alert("Connect an LLM first — open the LLM Connection panel and add an API key.");
      return;
    }
    var count = await saveAllFiles();
    consoleLog("💾 saved " + count + " file(s)", "info");
    renderChatView();
    var specNames = files.filter(function (x) { return isSpec(x.id); })
      .map(function (s) { return s.name; });
    chatInput.value = "I've synced the current project code. Review all the current project files" +
      (specNames.length ? " against the spec(s) (" + specNames.join(", ") + ")" : "") +
      " and update the Verilog implementation as needed.";
    sendChat();
    consoleLog("🔄 synced current code to the AI", "info");
  }

  // "Use as spec" adds the open .md to the specs (+ build); "Remove spec" drops it.
  useSpecBtn.addEventListener("click", function () {
    syncCurrentFileFromEditor();
    var f = files.find(function (x) { return x.id === currentFileId; });
    if (!f) return;
    if (isSpec(f.id)) {
      removeSpec(f.id);
      updateSpecButton();
      renderAttachments();
      renderFileList();
      consoleLog("📄 removed spec: " + f.name, "info");
    } else {
      saveCurrentFile();  // persist the Markdown first
      useAsSpec(f);       // attach to the chat (no send)
    }
  });
  // "Sync current code": save the project and send it to the LLM (needs a spec).
  syncBtn.addEventListener("click", syncCurrentCode);

  function openEditorPanel() {
    noSelection.classList.add("hidden");
    editorPanel.classList.remove("hidden");
    if (editor) editor.resize();
  }

  function closeEditorPanel() {
    editorPanel.classList.add("hidden");
    noSelection.classList.remove("hidden");
  }

  function saveCurrentFile() {
    if (currentFileId == null) return;
    var name = fileNameInput.value.trim() || "untitled.v";
    var code = editor.getValue();
    fileNameInput.value = name;
    saveBtn.disabled = true;
    var label = saveBtn.textContent;
    saveBtn.textContent = "Saving…";
    dbUpdateFile(currentFileId, { name: name, code: code }).then(function (res) {
        saveBtn.disabled = false;
        if (res.error) {
          saveBtn.textContent = label;
          alert("Could not save: " + res.error.message);
          return;
        }
        var idx = files.findIndex(function (f) { return f.id === currentFileId; });
        if (idx !== -1) files[idx] = res.data;
        files.sort(function (a, b) { return a.name.localeCompare(b.name); });
        renderFileList();
        saveBtn.textContent = "Saved ✓";
        setTimeout(function () { saveBtn.textContent = "Save"; }, 1200);
      });
  }

  saveBtn.addEventListener("click", saveCurrentFile);

  // -------------------------------------------------------------------------
  // Push the current project to GitHub (uses a Personal Access Token)
  // -------------------------------------------------------------------------
  function syncCurrentFileFromEditor() {
    if (currentFileId == null || !editor) return;
    var f = files.find(function (x) { return x.id === currentFileId; });
    if (f) f.code = editor.getValue();
  }

  // GitHub auth state, set when the dialog opens, reused when confirmed.
  var ghHeaders = null;
  var ghOwner = null;

  // Step 1: authenticate, fetch the user's repos, and open the chooser dialog.
  async function pushToGitHub() {
    if (currentProjectId == null || !files.length) {
      alert("Open a project with at least one file first.");
      return;
    }
    syncCurrentFileFromEditor(); // include unsaved edits of the open file

    var token = localStorage.getItem("github_pat");
    if (!token) {
      token = prompt(
        "Paste a GitHub Personal Access Token.\n\n" +
        "Create one at github.com/settings/tokens with 'repo' scope " +
        "(or a fine-grained token with 'Contents' + 'Administration: Read and write')."
      );
      if (!token) return;
      token = token.trim();
      localStorage.setItem("github_pat", token);
    }
    ghHeaders = {
      "Authorization": "Bearer " + token,
      "Accept": "application/vnd.github+json",
    };

    githubPushBtn.disabled = true;
    var label = githubPushBtn.textContent;
    githubPushBtn.textContent = "Loading…";
    try {
      var meResp = await fetch("https://api.github.com/user", { headers: ghHeaders });
      if (!meResp.ok) {
        localStorage.removeItem("github_pat");
        throw new Error("GitHub login failed — token may be wrong or expired. Click GitHub again to re-enter it.");
      }
      ghOwner = (await meResp.json()).login;

      // List the user's own repos to offer as choices.
      var reposResp = await fetch(
        "https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner",
        { headers: ghHeaders }
      );
      var repos = reposResp.ok ? await reposResp.json() : [];

      // Fill the dropdown: "create new" first, then existing repos.
      ghRepoSelect.innerHTML = "";
      var newOpt = document.createElement("option");
      newOpt.value = "__new__";
      newOpt.textContent = "➕ Create a new repository";
      ghRepoSelect.appendChild(newOpt);
      repos.forEach(function (r) {
        var o = document.createElement("option");
        o.value = r.name;
        o.textContent = r.name + (r.private ? " (private)" : "");
        ghRepoSelect.appendChild(o);
      });

      // Preselect this project's remembered repo if it still exists.
      var savedRepo = localStorage.getItem("gh_repo_" + currentProjectId);
      if (savedRepo && repos.some(function (r) { return r.name === savedRepo; })) {
        ghRepoSelect.value = savedRepo;
      } else {
        ghRepoSelect.value = "__new__";
        ghNewName.value = (projectNameInput.value.trim() || "verilog-project")
          .toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
      }
      updateGhModalFields();
      ghModal.classList.remove("hidden");
    } catch (err) {
      alert(err.message || String(err));
    } finally {
      githubPushBtn.disabled = false;
      githubPushBtn.textContent = label;
    }
  }

  // Show the "new name" + "private" fields only when creating a new repo.
  function updateGhModalFields() {
    var isNew = ghRepoSelect.value === "__new__";
    ghNewNameField.classList.toggle("hidden", !isNew);
    ghPrivateField.classList.toggle("hidden", !isNew);
  }

  // Swap to a different token (used when the current one lacks permission).
  async function swapGhToken() {
    var t = prompt(
      "Enter a different GitHub Personal Access Token.\n" +
      "A classic token with the 'repo' scope works best for creating repos."
    );
    if (!t) return false;
    t = t.trim();
    ghHeaders = {
      "Authorization": "Bearer " + t,
      "Accept": "application/vnd.github+json",
    };
    var meResp = await fetch("https://api.github.com/user", { headers: ghHeaders });
    if (!meResp.ok) {
      alert("That token didn't authenticate — check it and try again.");
      return false;
    }
    ghOwner = (await meResp.json()).login;
    localStorage.setItem("github_pat", t);
    // Classic tokens report their scopes in this header — warn if 'repo' is missing.
    var scopes = meResp.headers.get("x-oauth-scopes");
    if (scopes && scopes.indexOf("repo") === -1) {
      alert("This classic token's scopes are: '" + scopes + "'.\n" +
        "To create repositories it needs the 'repo' scope — regenerate the token with 'repo' checked.");
    }
    return true;
  }

  // The actual work: create the repo (if new) and push every file. Throws on error.
  async function doGhPush(isNew, repo, isPrivate) {
    if (isNew) {
      var createResp = await fetch("https://api.github.com/user/repos", {
        method: "POST",
        headers: Object.assign({ "Content-Type": "application/json" }, ghHeaders),
        body: JSON.stringify({ name: repo, auto_init: true, private: isPrivate }),
      });
      if (!createResp.ok) {
        var ce = await createResp.json().catch(function () { return {}; });
        throw new Error("Could not create repo: " + (ce.message || createResp.status));
      }
    }

    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      var path = (f.name || ("file" + i + ".v")).replace(/^\/+/, "");
      var contentsUrl = "https://api.github.com/repos/" + ghOwner + "/" + repo +
        "/contents/" + encodeURIComponent(path);
      var b64 = btoa(unescape(encodeURIComponent(f.code || "")));

      var existingSha = null;
      var getResp = await fetch(contentsUrl, { headers: ghHeaders });
      if (getResp.ok) { existingSha = (await getResp.json()).sha; }

      var body = { message: (existingSha ? "Update " : "Add ") + path, content: b64 };
      if (existingSha) { body.sha = existingSha; }

      var putResp = await fetch(contentsUrl, {
        method: "PUT",
        headers: Object.assign({ "Content-Type": "application/json" }, ghHeaders),
        body: JSON.stringify(body),
      });
      if (!putResp.ok) {
        var pe = await putResp.json().catch(function () { return {}; });
        throw new Error("Failed to push " + path + ": " + (pe.message || putResp.status));
      }
    }

    localStorage.setItem("gh_repo_" + currentProjectId, repo);
  }

  // Step 2: orchestrate the push, with token-swap recovery on permission errors.
  async function confirmGhPush() {
    var isNew = ghRepoSelect.value === "__new__";
    var repo = isNew ? ghNewName.value.trim() : ghRepoSelect.value;
    if (!repo) { alert("Enter a repository name."); return; }
    var isPrivate = ghPrivate.checked;

    ghModal.classList.add("hidden");
    githubPushBtn.disabled = true;
    var label = githubPushBtn.textContent;
    githubPushBtn.textContent = "Pushing…";

    try {
      try {
        await doGhPush(isNew, repo, isPrivate);
      } catch (err) {
        var msg = err.message || String(err);
        var permissionIssue = /not accessible|forbidden|permission|not found|\b403\b|\b404\b/i.test(msg);
        if (permissionIssue && confirm(
          msg + "\n\nThis token may lack the permission for that action.\n" +
          "Enter a different token and retry?"
        )) {
          if (await swapGhToken()) {
            await doGhPush(isNew, repo, isPrivate); // retry with the new token
          } else {
            return; // user cancelled the new token
          }
        } else {
          throw err; // not a permission issue, or user declined
        }
      }

      var url = "https://github.com/" + ghOwner + "/" + repo;
      alert("Pushed " + files.length + " file(s) to " + url);
    } catch (err) {
      alert(err.message || String(err));
    } finally {
      githubPushBtn.disabled = false;
      githubPushBtn.textContent = label;
    }
  }

  githubPushBtn.addEventListener("click", pushToGitHub);
  ghRepoSelect.addEventListener("change", updateGhModalFields);
  ghCancelBtn.addEventListener("click", function () { ghModal.classList.add("hidden"); });
  ghConfirmBtn.addEventListener("click", confirmGhPush);

  // -------------------------------------------------------------------------
  // Export: download the current file, or the whole project as a .zip
  // -------------------------------------------------------------------------
  function downloadBlob(filename, blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function openExportDialog() {
    if (currentProjectId == null || !files.length) {
      alert("Open a project with at least one file first.");
      return;
    }
    syncCurrentFileFromEditor();
    var current = files.find(function (x) { return x.id === currentFileId; });
    exportFileBtn.textContent = "Download this file" +
      (current ? " (" + (current.name || "file") + ")" : "");
    exportFileBtn.disabled = !current;
    exportModal.classList.remove("hidden");
  }

  function exportCurrentFile() {
    exportModal.classList.add("hidden");
    syncCurrentFileFromEditor();
    var f = files.find(function (x) { return x.id === currentFileId; });
    if (!f) { alert("No file selected."); return; }
    downloadBlob(f.name || "file.v", new Blob([f.code || ""], { type: "text/plain" }));
  }

  async function exportProject() {
    exportModal.classList.add("hidden");
    syncCurrentFileFromEditor();
    if (!files.length) { alert("No files to export."); return; }
    var folder = (projectNameInput.value.trim() || "project")
      .replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "project";
    var zip = new JSZip();
    var dir = zip.folder(folder);
    files.forEach(function (f) { dir.file(f.name || "file.v", f.code || ""); });
    var blob = await zip.generateAsync({ type: "blob" });
    downloadBlob(folder + ".zip", blob);
  }

  exportBtn.addEventListener("click", openExportDialog);
  exportFileBtn.addEventListener("click", exportCurrentFile);
  exportProjectBtn.addEventListener("click", exportProject);
  exportCancelBtn.addEventListener("click", function () { exportModal.classList.add("hidden"); });

  // Delete any file by id (used by the right-click menu).
  // Actual deletion (no prompt).
  function doDeleteFile(id) {
    var f = files.find(function (x) { return x.id === id; });
    if (!f) return;
    dbDeleteFile(id).then(function (res) {
      if (res.error) { alert("Could not delete file: " + res.error.message); return; }
      files = files.filter(function (x) { return x.id !== id; });
      if (currentFileId === id) {
        currentFileId = null;
        if (files.length) { openFile(files[0].id); } else { closeEditorPanel(); }
      }
      renderFileList();
    });
  }

  // Delete a file — confirms first, unless "Don't ask again" was chosen (persisted).
  var pendingDeleteId = null;
  function deleteFile(id) {
    var f = files.find(function (x) { return x.id === id; });
    if (!f) return;
    if (localStorage.getItem("skip_delete_confirm") === "true") { doDeleteFile(id); return; }
    pendingDeleteId = id;
    delModalText.textContent = "Delete \"" + (f.name || "file") + "\"? This cannot be undone.";
    delModal.classList.remove("hidden");
  }
  delCancelBtn.addEventListener("click", function () {
    delModal.classList.add("hidden");
    pendingDeleteId = null;
  });
  delConfirmBtn.addEventListener("click", function () {
    delModal.classList.add("hidden");
    if (pendingDeleteId != null) doDeleteFile(pendingDeleteId);
    pendingDeleteId = null;
  });
  delDontAskBtn.addEventListener("click", function () {
    localStorage.setItem("skip_delete_confirm", "true"); // remembered across sessions/logins
    delModal.classList.add("hidden");
    if (pendingDeleteId != null) doDeleteFile(pendingDeleteId);
    pendingDeleteId = null;
  });

  // Right-click file menu.
  var fileMenuTargetId = null;
  function showFileMenu(e, id) {
    fileMenuTargetId = id;
    fileMenu.style.left = Math.min(e.clientX, window.innerWidth - 160) + "px";
    fileMenu.style.top = Math.min(e.clientY, window.innerHeight - 60) + "px";
    fileMenu.classList.remove("hidden");
  }
  function hideFileMenu() { fileMenu.classList.add("hidden"); fileMenuTargetId = null; }
  fileMenuDelete.addEventListener("click", function () {
    var id = fileMenuTargetId;
    hideFileMenu();
    if (id != null) deleteFile(id);
  });
  document.addEventListener("click", hideFileMenu);
  document.addEventListener("scroll", hideFileMenu, true);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") hideFileMenu(); });

  // Cmd/Ctrl+S saves the current file.
  document.addEventListener("keydown", function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      if (!appView.classList.contains("hidden") && currentFileId != null) {
        e.preventDefault();
        saveCurrentFile();
      }
    }
  });

  // ---------------------------------------------------------------------------
  // Output console + lightweight Verilog static check
  // ---------------------------------------------------------------------------
  function clearOutput() {
    outputBody.textContent = "";
    outputPanel.classList.add("hidden");
  }

  function appendLine(text, kind) {
    var line = document.createElement("div");
    if (kind) line.className = "line-" + kind;
    line.textContent = text;
    outputBody.appendChild(line);
    outputPanel.classList.remove("hidden");
    outputBody.scrollTop = outputBody.scrollHeight;
  }

  // NOTE: not a real compiler/simulator. Real synthesis/simulation needs a
  // backend (e.g. Icarus Verilog) or a WASM build. This catches common
  // structural mistakes so the Run button is useful offline.
  function checkVerilog(code) {
    var errors = [];
    var warnings = [];
    var stripped = code
      .replace(/\/\/[^\n]*/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");

    if (stripped.trim() === "") {
      errors.push("Source is empty — nothing to compile.");
      return { errors: errors, warnings: warnings };
    }
    function count(re) { var m = stripped.match(re); return m ? m.length : 0; }

    var modules = count(/\bmodule\b/g);
    var endmodules = count(/\bendmodule\b/g);
    if (modules === 0) warnings.push("No 'module' declaration found.");
    if (modules !== endmodules) {
      errors.push("Unbalanced module blocks: " + modules + " 'module' vs " + endmodules + " 'endmodule'.");
    }
    var begins = count(/\bbegin\b/g);
    var ends = count(/\bend\b/g);
    if (begins !== ends) {
      errors.push("Unbalanced begin/end: " + begins + " 'begin' vs " + ends + " 'end'.");
    }
    var open = (stripped.match(/\(/g) || []).length;
    var close = (stripped.match(/\)/g) || []).length;
    if (open !== close) {
      errors.push("Unbalanced parentheses: " + open + " '(' vs " + close + " ')'.");
    }
    return { errors: errors, warnings: warnings };
  }

  function runCode() {
    if (!editor) return;
    clearOutput();
    var fname = fileNameInput.value.trim() || "file";
    appendLine("> compiling " + fname + " …", "info");
    consoleLog("$ compile " + fname, "cmd");
    var result = checkVerilog(editor.getValue());
    result.warnings.forEach(function (w) { appendLine("warning: " + w, "warn"); });
    result.errors.forEach(function (er) { appendLine("error: " + er, "error"); });
    if (result.errors.length === 0) {
      appendLine("✓ No structural errors (" + result.warnings.length + " warning(s)).", "ok");
      appendLine("note: static check only, not a full simulation.", "info");
      consoleLog("✓ " + fname + ": 0 errors, " + result.warnings.length + " warning(s)", "ok");
    } else {
      appendLine("✗ Compile failed with " + result.errors.length + " error(s).", "error");
      consoleLog("✗ " + fname + ": " + result.errors.length + " error(s)", "error");
    }
  }

  clearBtn.addEventListener("click", clearOutput);
  if (viewDiagramBtn) viewDiagramBtn.addEventListener("click", function () {
    if (moreMenu) moreMenu.classList.add("hidden"); // it now lives in the More menu
    showDiagram();
  });
  if (diagramClose) diagramClose.addEventListener("click", hideDiagram);

  // Resizable docked LLM Connection pane — drag its left edge (min/max clamped).
  (function setupChatResizer() {
    var handle = $("chat-resizer");
    if (!handle) return;
    var MIN = 300;
    function maxW() { return Math.min(760, Math.max(MIN, window.innerWidth - 340)); }
    function clampW(w) { return Math.max(MIN, Math.min(maxW(), w)); }
    function readW() {
      return parseInt(getComputedStyle(document.body).getPropertyValue("--chat-w"), 10);
    }
    function applyW(w) {
      document.body.style.setProperty("--chat-w", clampW(w) + "px");
      if (editor) editor.resize();
    }
    var saved = parseInt(localStorage.getItem("chat_width"), 10);
    if (saved) document.body.style.setProperty("--chat-w", clampW(saved) + "px");

    var dragging = false;
    function pointX(e) { return e.touches ? e.touches[0].clientX : e.clientX; }
    function onMove(e) {
      if (!dragging) return;
      applyW(window.innerWidth - pointX(e)); // panel is docked to the right edge
      e.preventDefault();
    }
    function onUp() {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove("chat-resizing");
      var w = readW();
      if (w) localStorage.setItem("chat_width", w);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onUp);
    }
    function onDown(e) {
      dragging = true;
      document.body.classList.add("chat-resizing");
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      document.addEventListener("touchmove", onMove, { passive: false });
      document.addEventListener("touchend", onUp);
      e.preventDefault();
    }
    handle.addEventListener("mousedown", onDown);
    handle.addEventListener("touchstart", onDown, { passive: false });
    window.addEventListener("resize", function () {
      var w = readW();
      if (w) applyW(w); // re-clamp if the window got smaller
    });
  })();

  // Console Resizer
  (function () {
    var handle = document.querySelector(".console-resize-top");
    if (!handle) return;
    var dragging = false;
    function readH() {
      var h = parseFloat(document.body.style.getPropertyValue("--console-h"));
      return isNaN(h) ? 180 : h;
    }
    function applyH(h) {
      if (h < 50) h = 50; // min height
      var max = window.innerHeight * 0.8;
      if (h > max) h = max;
      document.body.style.setProperty("--console-h", h + "px");
      if (editor) editor.resize();
    }
    function pointY(e) { return e.touches ? e.touches[0].clientY : e.clientY; }
    function onMove(e) {
      if (!dragging) return;
      var y = pointY(e);
      applyH(window.innerHeight - y);
      e.preventDefault();
    }
    function onUp() {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove("console-resizing");
      var h = readH();
      if (h) localStorage.setItem("docked_console_h", h);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onUp);
    }
    function onDown(e) {
      if (!document.body.classList.contains("chat-docked")) return;
      dragging = true;
      document.body.classList.add("console-resizing");
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      document.addEventListener("touchmove", onMove, { passive: false });
      document.addEventListener("touchend", onUp);
      e.preventDefault();
    }
    handle.addEventListener("mousedown", onDown);
    handle.addEventListener("touchstart", onDown, { passive: false });
    var savedH = localStorage.getItem("docked_console_h");
    if (savedH) applyH(parseFloat(savedH));
  })();

  // ---------------------------------------------------------------------------
  // Verifier → approval → Builder flow (LangGraph backend, human-in-the-loop)
  // ---------------------------------------------------------------------------
  var specModal = $("spec-modal");
  var specModalText = $("spec-modal-text");
  var specChangesWrap = $("spec-changes-wrap");
  var specChangesInput = $("spec-changes");
  var specCancelBtn = $("spec-cancel");
  var specRejectBtn = $("spec-reject");
  var specApproveBtn = $("spec-approve");
  var specSendChangesBtn = $("spec-send-changes");
  var specBackBtn = $("spec-back");
  var flowThreadId = null;
  var lastFlowSpec = "";
  var lastFlowData = null; // last build's internal data (dev view)

  function setSpecBusy(busy) {
    specApproveBtn.disabled = busy;
    specRejectBtn.disabled = busy;
    specSendChangesBtn.disabled = busy;
    specCancelBtn.disabled = busy;
    specBackBtn.disabled = busy;
  }
  // Review view: Cancel · Request changes · Looks good — build it
  function showSpecReview() {
    specChangesWrap.classList.add("hidden");
    specSendChangesBtn.classList.add("hidden");
    specBackBtn.classList.add("hidden");
    specRejectBtn.classList.remove("hidden");
    specApproveBtn.classList.remove("hidden");
    specCancelBtn.classList.remove("hidden");
  }
  // Change-request view: Back · Cancel · Send changes
  function showSpecChangeRequest() {
    specChangesWrap.classList.remove("hidden");
    specSendChangesBtn.classList.remove("hidden");
    specBackBtn.classList.remove("hidden");
    specRejectBtn.classList.add("hidden");
    specApproveBtn.classList.add("hidden");
    specCancelBtn.classList.remove("hidden");
    specChangesInput.focus();
  }
  function showSpecModal(spec) {
    lastFlowSpec = spec || "";
    specModalText.textContent = spec || "(the Verifier returned an empty spec)";
    specChangesInput.value = "";
    showSpecReview();
    setSpecBusy(false);
    specModal.classList.remove("hidden");
  }
  function hideSpecModal() { specModal.classList.add("hidden"); }

  // namingText: the full request used to name the project (prompt + any attached
  // spec contents). namingImages: data-URL images attached to the request, so the
  // namer can look at diagrams/screenshots too.
  async function ensureProject(namingText, namingImages) {
    if (currentProjectId != null) return true;
    var initialName = "Generating name...";
    var res = await dbCreateProject(initialName);
    if (res.error) {
      alert("Could not create project: " + res.error.message);
      return false;
    }
    var project = res.data;
    projects.unshift(project);
    currentProjectId = project.id;
    projectNameInput.value = project.name;
    filesSection.classList.remove("hidden");
    renderProjectList();
    files = [];
    renderFileList();

    // Asynchronously ask the LLM for a better name
    (async function() {
      try {
        var provider = currentProvider();
        var key = getProviderKey(provider);
        var model = getProviderModel(provider);
        if (!key || !model) return;
        var sys = "You are a naming assistant for a Verilog hardware design tool. " +
          "You are given the user's request to build a project — this may include a written prompt, " +
          "the contents of attached specification file(s), and attached image(s) (e.g. block diagrams or screenshots). " +
          "Read all of it and output ONLY a short, specific project name (2-5 words) describing what is being built " +
          "(e.g. \"UART Transmitter\", \"8-bit CRC Generator\"). No quotes, no markdown, no preamble.";
        var namingMsg = { role: "user", content: namingText || "Name this hardware project.", images: namingImages || [] };
        var reply = await callLLM(provider, key, model, sys, [namingMsg]);
        var generatedName = reply.trim().replace(/^["']|["']$/g, "").slice(0, 50);
        if (generatedName && currentProjectId === project.id) {
          await dbRenameProject(project.id, generatedName);
          project.name = generatedName;
          projectNameInput.value = generatedName;
          renderProjectList();
        }
      } catch(e) {
        consoleLog("Failed to generate project name: " + e, "warn");
      }
    })();

    return true;
  }

  async function startVerifierFlow() {
    var base = getBackendUrl();
    if (!base) {
      consoleLog("⚠ Set a backend first (Console → ⚙ Backend) to use Verify & Build.", "error");
      return;
    }
    var provider = currentProvider();
    var key = getProviderKey(provider);
    if (!key) { renderChatView(); return; }
    var promptText = chatInput.value.trim();
    var imgs = pendingImages.slice();
    if (!promptText && !imgs.length) { chatInput.focus(); return; }

    var model = getProviderModel(provider);

    // Pull in any Markdown specs attached to the chat.
    syncCurrentFileFromEditor(); // capture unsaved edits to an open spec
    var specFiles = getSpecIds()
      .map(function (id) { return files.find(function (f) { return f.id === id; }); })
      .filter(Boolean);
    var fullPrompt = promptText;
    if (specFiles.length) {
      fullPrompt += "\n\nAttached specification file(s):\n\n" +
        specFiles.map(function (s) { return "=== " + s.name + " ===\n" + (s.code || ""); }).join("\n\n");
    }

    chatInput.value = "";
    pendingImages = [];
    renderAttachments();
    
    var attachedNames = specFiles.map(function (s) { return s.name; });
    var displayUserMsg = promptText + (attachedNames.length ? "\n\n📎 " + attachedNames.join(", ") : "");
    appendChatMsg("user", displayUserMsg, imgs);
    chatHistory.push({ role: "user", content: displayUserMsg, images: imgs });
    try { await saveConversation(); } catch (e) {}

    var bubble = appendChatMsg("assistant", "🤔 Thinking...");
    chatSend.disabled = true;

    // Check if it's a project request
    var isProject = true;
    if (!imgs.length) {
        try {
            var sysRoute = "Does the user's prompt explicitly ask to build, write, design, or create a Verilog or hardware project? If it is just a conversational greeting, general question, or unrelated text, reply NO. Reply only YES or NO.";
            var routeRes = await callLLM(provider, key, model, sysRoute, [{role: "user", content: promptText}]);
            if (routeRes.trim().toUpperCase().includes("NO") && !routeRes.trim().toUpperCase().includes("YES")) {
                isProject = false;
            }
        } catch(e) { }
    }

    if (!isProject) {
        // Fallback to normal chatbot behavior
        try {
            var sys = buildProjectContext();
            var reply = await callLLM(provider, key, model, sys, chatHistory);
            var displayReply = stripFileBlocks(reply);
            bubble.textContent = displayReply;
            chatHistory.push({ role: "assistant", content: displayReply });

            var edits = parseFileEdits(reply);
            if (edits.length > 0) {
                var ok = await ensureProject(fullPrompt || promptText || "New AI Project", imgs);
                if (ok) {
                    var applied = await applyFileEdits(edits);
                    if (applied.length) {
                        var msg1 = "✎ Updated " + applied.length + " file(s): " + applied.join(", ");
                        appendChatMsg("assistant", msg1);
                        chatHistory.push({ role: "assistant", content: msg1 });
                    }
                    if (applied.length < edits.length) {
                        var msg2 = "⚠ Failed to save some files. Check the Console for details.";
                        appendChatMsg("assistant", msg2).classList.add("chat-error");
                        chatHistory.push({ role: "assistant", content: msg2 });
                    }
                }
            }
        } catch (err) {
            bubble.textContent = "Error: " + (err.message || err);
            bubble.classList.add("chat-error");
        } finally {
            chatSend.disabled = false;
            chatConversation.scrollTop = chatConversation.scrollHeight;
            try { await saveConversation(); } catch (e) {}
        }
        return;
    }

    var ok = await ensureProject(fullPrompt, imgs);
    if (!ok) {
        chatSend.disabled = false;
        bubble.textContent = "⚠ Failed to create project.";
        return;
    }

    bubble.textContent = "🧭 Verifier is writing the spec…";
    try {
      var resp;
      var retries = 0;
      while (true) {
        try {
          resp = await fetch(base + "/flow/start", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt: fullPrompt, provider: provider, key: key, builderModel: model }),
          });
          break; // successfully connected!
        } catch (e) {
          bubble.textContent = "⚠ Couldn't reach backend. Retrying connection...";
          // Wait 2 seconds before trying again
          await new Promise(function(resolve) { setTimeout(resolve, 2000); });
        }
      }

      var data = await resp.json();
      if (data.error) {
        bubble.textContent = "⚠ " + data.error;
        bubble.classList.add("chat-error");
        return;
      }
      flowThreadId = data.threadId;
      bubble.textContent = "🧭 Verifier wrote a spec — please review it.";
      showSpecModal(data.spec);
    } catch (e) {
      bubble.textContent = "⚠ Error processing response: " + ((e && e.message) || e);
      bubble.classList.add("chat-error");
    } finally {
      chatSend.disabled = false;
    }
  }

  async function flowDecision(approved, changes) {
    var base = getBackendUrl();
    if (!base || !flowThreadId) return;
    setSpecBusy(true);

    var bubble = null;
    if (approved) {
      hideSpecModal();
      bubble = appendChatMsg("assistant", "🔨 Building… compiling each module with iverilog. This can take a moment.");
    } else {
      specModalText.textContent = "Verifier is revising the spec based on your changes…";
    }

    try {
      var resp;
      var retries = 0;
      while (true) {
        try {
          resp = await fetch(base + "/flow/approve", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ threadId: flowThreadId, approved: approved, changes: changes || "" }),
          });
          break; // successfully connected!
        } catch (e) {
          var retryText = "⚠ Couldn't reach backend. Retrying connection...";
          if (bubble) bubble.textContent = retryText;
          else specModalText.textContent = retryText;
          await new Promise(function(resolve) { setTimeout(resolve, 2000); });
        }
      }
      // The response is newline-delimited JSON: build events stream in live,
      // then a final line carries the result. (Rejections send only that line.)
      var data = await readFlowStream(resp);
      if (!data || data.error) {
        var errText = "⚠ " + ((data && data.error) || "no response from backend");
        if (bubble) { bubble.textContent = errText; bubble.classList.add("chat-error"); }
        else specModalText.textContent = errText;
        setSpecBusy(false);
        return;
      }
      if (!data.done) { showSpecModal(data.spec); return; } // revised spec → review again
      if (!approved) hideSpecModal(); // hide it if it was open during revise
      flowThreadId = null;
      await finishFlowBuild(data);
    } catch (e) {
      var errText = "⚠ " + ((e && e.message) || e);
      if (bubble) { bubble.textContent = errText; bubble.classList.add("chat-error"); }
      else specModalText.textContent = errText;
      setSpecBusy(false);
    }
  }

  // Log a single build event live (used as the NDJSON stream arrives).
  function logBuildEvent(ev) {
    if (!ev) return;
    if (ev.type === "plan") {
      consoleLog("📋 plan: " + (ev.order || []).join(" → "), "info");
      if (ev.cycle && ev.cycle.length) consoleLog("⚠ dependency cycle: " + ev.cycle.join(", "), "error");
    } else if (ev.type === "building") {
      consoleLog("🔨 building " + ev.module + "…", "info");
    } else if (ev.type === "attempt") {
      if (ev.ok) {
        consoleLog("✓ " + ev.module + " compiled (attempt " + ev.attempt + ")", "ok");
      } else if (ev.attempt < ev.maxTries) {
        consoleLog("↻ " + ev.module + " attempt " + ev.attempt + "/" + ev.maxTries +
          " failed — retrying… " + String(ev.error || "").split("\n")[0], "warn");
      }
      // final-attempt failure is reported by the 'built' event below
    } else if (ev.type === "conformance") {
      if (ev.ok === false) {
        consoleLog("⚠ " + ev.module + ": Verifier found a SPEC violation — sending back to the Builder to fix" +
          (ev.issues ? " (" + String(ev.issues).split("\n")[0].slice(0, 120) + ")" : ""), "warn");
      } else {
        consoleLog("✓ " + ev.module + ": conforms to the spec", "ok");
      }
    } else if (ev.type === "summary") {
      consoleLog("📝 " + ev.module + ": described for the Verifier (ports, params, function, clock/reset)", "info");
    } else if (ev.type === "floor") {
      consoleLog("🧪 " + ev.module + " — " + ev.tier + " tier checks:", "info");
      // Lint (all modules)
      if (ev.lintClean) {
        consoleLog("   • lint: clean ✓", "ok");
      } else {
        consoleLog("   • lint: issues ✗" + (ev.lintReason ? " — " + ev.lintReason : ""), "error");
      }
      // Generic synthesis (all modules)
      if (ev.synthAvailable === false) {
        consoleLog("   • synthesis: skipped (yosys not installed) — sim-only scan still ran", "warn");
      } else if (ev.synthesizable === true) {
        consoleLog("   • synthesis: synthesizable ✓", "ok");
      } else if (ev.synthesizable === false) {
        consoleLog("   • synthesis: NOT synthesizable ✗" + (ev.synthReason ? " — " + ev.synthReason : ""), "error");
      }
      if (ev.tier === "smoke") {
        // Smoke testbench (code-generated, no oracle)
        if (ev.smokeSimPassed === true) {
          consoleLog("   • smoke testbench: PASSED ✓ (no undefined outputs)", "ok");
        } else if (ev.smokeSimPassed === false) {
          consoleLog("   • smoke testbench: FAILED ✗" + (ev.smokeSimReason ? " — " + ev.smokeSimReason : ""), "error");
        } else {
          consoleLog("   • smoke testbench: inconclusive (couldn't parse/run)", "warn");
        }
        consoleLog("   → floor tier " + (ev.verification === "smoke" ? "PASSED ✓" : "FAILED ✗"),
          ev.verification === "smoke" ? "ok" : "error");
      } else {
        // Smoke baseline (code-generated) runs on functional modules too — a
        // reliable "does the module run clean?" signal, independent of the oracle.
        if (ev.smokeSimPassed === true) {
          consoleLog("   • smoke baseline: runs clean ✓ (no undefined outputs)", "ok");
        } else if (ev.smokeSimPassed === false) {
          consoleLog("   • smoke baseline: module produces X ✗" + (ev.smokeSimReason ? " — " + ev.smokeSimReason : ""), "error");
        } else {
          consoleLog("   • smoke baseline: inconclusive (testbench couldn't run)", "warn");
        }
        // Functional oracle testbench (LLM-written, checks against the spec)
        if (ev.funcTbPassed === true) {
          consoleLog("   • functional testbench (oracle): PASSED ✓", "ok");
        } else if (ev.funcTbPassed === false) {
          consoleLog("   • functional testbench (oracle): FAILED ✗" + (ev.funcTbReason ? " — " + ev.funcTbReason : ""), "error");
        } else {
          // Distinguish a broken oracle (smoke ran clean) from a genuinely unclear result.
          var oracleMsg = ev.smokeSimPassed === true
            ? "inconclusive — oracle testbench couldn't compile (module runs clean, so the TEST was broken)"
            : "inconclusive (couldn't compile/run)";
          consoleLog("   • functional testbench (oracle): " + oracleMsg, "warn");
        }
        consoleLog("   → functional tier " + (ev.verification === "functional" ? "VERIFIED ✓" : "not verified ✗"),
          ev.verification === "functional" ? "ok" : "warn");
      }
    } else if (ev.type === "drill") {
      var pad = "   " + new Array((ev.depth || 0) + 1).join("  ");
      if (ev.result === "functional") {
        consoleLog(pad + "✓ " + ev.module + " functionally verified", "ok");
      } else if (ev.result === "failed") {
        consoleLog(pad + "✗ " + ev.module + " functional test FAILED — localizing…" +
          (ev.details ? " (" + String(ev.details).split(";")[0] + ")" : ""), "error");
      } else if (ev.result === "inconclusive") {
        consoleLog(pad + "• " + ev.module + " functional test inconclusive (couldn't compile/run)", "warn");
      } else if (ev.result === "unfixable") {
        consoleLog(pad + "✗ " + ev.module + " could not be auto-corrected", "error");
      } else if (ev.msg) {
        consoleLog(pad + "↳ " + ev.module + ": " + ev.msg, "info");
      }
    } else if (ev.type === "reviewing") {
      consoleLog("🔎 Verifier reviewing " + ev.count + " module summary/summaries against the spec…", "info");
    } else if (ev.type === "built" && !ev.ok) {
      consoleLog("✗ " + ev.module + " FAILED after " + ev.attempts + " attempts: " +
        String(ev.error || "").slice(0, 200), "error");
    }
  }

  // Read a newline-delimited-JSON stream: log progress events as they land,
  // return the final (non-progress) message.
  async function readFlowStream(resp) {
    if (!resp.body || !resp.body.getReader) return await resp.json(); // fallback
    var reader = resp.body.getReader();
    var decoder = new TextDecoder();
    var buf = "";
    var finalMsg = null;
    function handleLine(line) {
      line = line.trim();
      if (!line) return;
      var msg;
      try { msg = JSON.parse(line); } catch (e) { return; }
      if (msg.type === "progress") logBuildEvent(msg.event);
      else finalMsg = msg; // {done,...} or {error}
    }
    while (true) {
      var chunk = await reader.read();
      if (chunk.done) break;
      buf += decoder.decode(chunk.value, { stream: true });
      var parts = buf.split("\n");
      buf = parts.pop();
      parts.forEach(handleLine);
    }
    if (buf) handleLine(buf);
    return finalMsg;
  }

  // Build a Markdown doc of the module summaries the Builder handed the Verifier.
  function summariesToMarkdown(summaries) {
    if (!summaries || !summaries.length) return "";
    var out = ["# Module summaries (Builder → Verifier)", "",
      "_Interface and conventions for each built module — no source code._", ""];
    summaries.forEach(function (s) {
      out.push("## " + (s.module || "module"));
      if (s.intendedFunction) out.push("**Intended function:** " + s.intendedFunction);
      if (s.ports && s.ports.length) {
        out.push("", "**Ports:**");
        s.ports.forEach(function (p) {
          out.push("- `" + (p.direction || "?") + "` " + (p.name || "?") + " " + (p.width || ""));
        });
      }
      if (s.parameters && s.parameters.length) {
        out.push("", "**Parameters:**");
        s.parameters.forEach(function (p) {
          out.push("- " + (p.name || "?") + " = " + (p.default != null ? p.default : "n/a"));
        });
      }
      if (s.clockReset) {
        var c = s.clockReset;
        out.push("", "**Clock/reset conventions:**");
        if (c.clockTrigger) out.push("- Clock trigger: " + c.clockTrigger);
        if (c.clockRate) out.push("- Clock rate: " + c.clockRate);
        if (c.clocks) out.push("- Clocks: " + c.clocks);
        if (c.resetType) out.push("- Reset type: " + c.resetType);
        if (c.resetTrigger) out.push("- Reset trigger: " + c.resetTrigger);
      }
      out.push("");
    });
    return out.join("\n");
  }

  async function finishFlowBuild(data) {
    lastFlowData = data; // capture for the developer view
    updateDevButton();
    consoleLog("✅ Spec approved — Builder finished.", "ok");
    if (currentProjectId == null) { consoleLog("⚠ Open a project to save the built files.", "error"); return; }
    var filesObj = data.files || {};
    var edits = [];
    if (lastFlowSpec) edits.push({ name: "spec.md", content: lastFlowSpec });
    // Save the Builder→Verifier module summaries + the Verifier's review as files.
    var summariesMd = summariesToMarkdown(data.summaries);
    if (summariesMd) {
      var doc = summariesMd;
      if (data.review) doc += "\n\n---\n\n# Verifier review\n\n" + data.review;
      edits.push({ name: "module_summaries.md", content: doc });
    }
    // Dependency graph (module list + Mermaid diagram) — viewable via 📊 Diagram.
    if (data.dependencyGraph) {
      edits.push({ name: "dependency_graph.md", content: data.dependencyGraph });
    }
    Object.keys(filesObj).forEach(function (n) {
      edits.push({ name: /\.s?v$/i.test(n) ? n : n + ".v", content: filesObj[n] });
    });
    if (Object.keys(filesObj).length) {
      var applied = await applyFileEdits(edits);
      var msg1 = "🏗 Built " + Object.keys(filesObj).length + " module(s) and saved the spec. Files: " + applied.join(", ");
      appendChatMsg("assistant", msg1);
      chatHistory.push({ role: "assistant", content: msg1 });

      if (applied.length < edits.length) {
        var msg2 = "⚠ Failed to save some files. Check the Console for details.";
        appendChatMsg("assistant", msg2).classList.add("chat-error");
        chatHistory.push({ role: "assistant", content: msg2 });
      }
      if (data.review) {
        var msg3 = "🔎 Verifier review (from the module summaries, not the code):\n\n" + data.review;
        appendChatMsg("assistant", msg3);
        chatHistory.push({ role: "assistant", content: msg3 });
      }
      if (data.dependencyGraph) {
        var msg5 = "📊 Created dependency_graph.md — open it and click the 📊 Diagram button to view the module dependency graph.";
        appendChatMsg("assistant", msg5);
        chatHistory.push({ role: "assistant", content: msg5 });
      }
    } else {
      if (lastFlowSpec) await applyFileEdits(edits); // still save the spec
      var msg4 = "The build produced no compilable files — check the Console for the module that failed.";
      appendChatMsg("assistant", msg4);
      chatHistory.push({ role: "assistant", content: msg4 });
    }
    try { await saveConversation(); } catch (e) {}
  }

  if (specApproveBtn) specApproveBtn.addEventListener("click", function () { flowDecision(true, ""); });
  if (specRejectBtn) specRejectBtn.addEventListener("click", showSpecChangeRequest);
  if (specBackBtn) specBackBtn.addEventListener("click", showSpecReview); // back to review
  if (specSendChangesBtn) specSendChangesBtn.addEventListener("click", function () {
    var ch = specChangesInput.value.trim();
    if (!ch) { specChangesInput.focus(); return; }
    flowDecision(false, ch);
  });
  if (specCancelBtn) specCancelBtn.addEventListener("click", function () {
    hideSpecModal();
    flowThreadId = null;
  });

  // "More ▾" dropdown for the overflow toolbar actions.
  moreBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    moreMenu.classList.toggle("hidden");
  });
  document.addEventListener("click", function () { moreMenu.classList.add("hidden"); });

  // ---- Activity console (bottom-left): logs runs by the user and the AI ----
  function consoleLog(text, kind) {
    var line = document.createElement("div");
    line.className = "console-line" + (kind ? " " + kind : "");
    line.textContent = text;
    consoleBody.appendChild(line);
    consoleBody.scrollTop = consoleBody.scrollHeight;
    consolePanel.classList.remove("hidden"); // pop up on activity
    consoleToggle.classList.add("hidden");
  }
  consoleToggle.addEventListener("click", function () {
    consolePanel.classList.remove("hidden");
    consoleToggle.classList.add("hidden");
  });
  consoleCloseBtn.addEventListener("click", function () {
    consolePanel.classList.add("hidden");
    consoleToggle.classList.remove("hidden");
  });
  consoleClearBtn.addEventListener("click", function () { consoleBody.innerHTML = ""; });

  // ---- Developer view (internal LLM-reference state; hidden unless dev mode) ----
  var consoleDevBtn = $("console-dev");
  var devModal = $("dev-modal");
  var devCloseBtn = $("dev-close");
  var devBody = $("dev-body");
  var devTabButtons = document.querySelectorAll(".dev-tab");
  var devTab = "tracker";

  function isDevMode() { return localStorage.getItem("dev_mode") === "true"; }
  function updateDevButton() {
    if (consoleDevBtn) consoleDevBtn.classList.toggle("hidden", !isDevMode());
  }
  function setDevMode(on) {
    localStorage.setItem("dev_mode", on ? "true" : "false");
    updateDevButton();
    consoleLog(on ? "🛠 Developer mode ON (🛠 Dev button in the console header)" : "Developer mode off", "info");
    if (!on && devModal) devModal.classList.add("hidden");
  }
  // Toggle developer mode with Ctrl/Cmd + Shift + D.
  document.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "D" || e.key === "d")) {
      e.preventDefault();
      setDevMode(!isDevMode());
    }
  });

  function renderDevBody() {
    if (!devBody) return;
    devBody.innerHTML = "";
    var d = lastFlowData;
    if (!d) {
      devBody.innerHTML = '<p class="dev-empty">No build yet. Run a build (approve a spec) to populate this.</p>';
      return;
    }
    if (devTab === "tracker") {
      var manifest = d.manifest || [];
      if (!manifest.length) {
        devBody.innerHTML = '<p class="dev-empty">No module manifest in the last build.</p>';
        return;
      }
      var table = document.createElement("table");
      table.className = "dev-table";
      var thead = document.createElement("thead");
      var htr = document.createElement("tr");
      ["Module", "Built", "Tier", "Verification", "Own", "Effective"].forEach(function (h) {
        var th = document.createElement("th"); th.textContent = h; htr.appendChild(th);
      });
      thead.appendChild(htr); table.appendChild(thead);
      var tbody = document.createElement("tbody");
      manifest.forEach(function (m) {
        var tr = document.createElement("tr");
        var nameTd = document.createElement("td"); nameTd.textContent = m.name || "?";
        var builtTd = document.createElement("td");
        builtTd.className = m.built ? "dev-yes" : "dev-no";
        builtTd.textContent = m.built ? "✓ built" : "✗ not built";
        // Which tier this module is routed to (smoke = code-only floor; functional = needs oracle).
        var tierTd = document.createElement("td");
        tierTd.textContent = m.tier || "—";
        if (m.hasComputation) tierTd.title = "computes/transforms data → functional (regardless of score)";
        // Verification status: unverified / smoke / functional.
        var tbTd = document.createElement("td");
        var v = m.verification || (m.built ? "unverified" : "");
        tbTd.className = v === "functional" ? "dev-yes" : v === "smoke" ? "" : "dev-no";
        tbTd.textContent = v === "functional" ? "✓ functional" : v === "smoke" ? "◐ smoke" : (m.built ? "✗ unverified" : "—");
        // Build a tooltip describing the floor checks (lint + generic synthesis).
        var vtip = [];
        if (v === "smoke") vtip.push("floor passed: lint + generic synthesis + smoke testbench; function NOT yet proven");
        if (v === "functional") vtip.push("functionally verified: lint + generic synthesis + oracle testbench PASSED");
        if (m.synthesizable === false) vtip.push("generic synthesis FAILED (not buildable hardware)");
        else if (m.synthAvailable === false) vtip.push("synth skipped (yosys not installed)");
        if (m.smokeSimPassed === false) vtip.push("smoke testbench FAILED: " + (m.smokeSimOutput || "undefined output"));
        else if (m.smokeSimPassed === true) vtip.push("smoke testbench: no undefined outputs");
        if (m.funcTbPassed === false) vtip.push("functional oracle testbench FAILED: " + (m.funcTbOutput || "mismatch vs spec"));
        else if (m.funcTbPassed === true) vtip.push("functional oracle testbench PASSED");
        if (m.lintOutput) vtip.push("lint: " + m.lintOutput);
        if (m.synthOutput && m.synthesizable === false) vtip.push("synth: " + m.synthOutput);
        if (vtip.length) tbTd.title = vtip.join("\n");
        // Own complexity (this module's logic only), 1-100.
        var ownTd = document.createElement("td");
        ownTd.textContent = m.complexity != null ? m.complexity + "/100" : "—";
        if (m.complexity != null) {
          var parts = [];
          if (m.llmComplexity != null) parts.push("LLM " + m.llmComplexity);
          if (m.codeComplexity != null) parts.push("code " + m.codeComplexity);
          var tip = parts.length ? "avg of " + parts.join(" & ") : "";
          if (m.complexityRationale) tip += (tip ? " — " : "") + m.complexityRationale;
          if (tip) ownTd.title = tip;
        }
        // Effective complexity (own + not-yet-functionally-verified instantiated modules).
        var effTd = document.createElement("td");
        var eff = m.effectiveComplexity != null ? m.effectiveComplexity : m.complexity;
        effTd.textContent = eff != null ? String(eff) : "—";
        if (m.complexityDeps && m.complexityDeps.length) {
          effTd.title = "own " + m.complexity + " + unverified deps: " +
            m.complexityDeps.map(function (d) { return d.name + " (+" + d.added + ")"; }).join(", ");
        }
        tr.appendChild(nameTd); tr.appendChild(builtTd); tr.appendChild(tierTd); tr.appendChild(tbTd);
        tr.appendChild(ownTd); tr.appendChild(effTd);
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      devBody.appendChild(table);
    } else {
      var pre = document.createElement("pre");
      if (devTab === "summaries") pre.textContent = JSON.stringify(d.summaries || [], null, 2);
      else if (devTab === "review") pre.textContent = d.review || "(no verifier review)";
      else if (devTab === "log") pre.textContent = JSON.stringify(d.log || [], null, 2);
      devBody.appendChild(pre);
    }
  }
  function openDevModal() { renderDevBody(); if (devModal) devModal.classList.remove("hidden"); }
  if (consoleDevBtn) consoleDevBtn.addEventListener("click", openDevModal);
  if (devCloseBtn) devCloseBtn.addEventListener("click", function () { devModal.classList.add("hidden"); });
  devTabButtons.forEach(function (t) {
    t.addEventListener("click", function () {
      devTab = t.getAttribute("data-dev-tab");
      devTabButtons.forEach(function (x) { x.classList.remove("active"); });
      t.classList.add("active");
      renderDevBody();
    });
  });
  updateDevButton(); // reflect saved dev-mode state on load

  // ---- Backend (EC2) compile checks via iverilog ----
  function getBackendUrl() { return "https://verilogprojectcreate.duckdns.org"; }


  // POST files to the backend's /compile endpoint → { ok, output } (or null).
  async function backendCompile(files) {
    var base = getBackendUrl();
    if (!base) return null;
    try {
      var res;
      var retries = 0;
      while (true) {
        try {
          res = await fetch(base + "/compile", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ files: files }),
          });
          break; // successfully connected!
        } catch (e) {
          consoleLog("✗ backend unreachable. Retrying connection...", "warn");
          await new Promise(function(resolve) { setTimeout(resolve, 2000); });
        }
      }
      if (!res.ok) { consoleLog("✗ backend error: HTTP " + res.status, "error"); return null; }
      return await res.json();
    } catch (err) {
      consoleLog("✗ backend unreachable (" + (err.message || err) + "). Is it running + port 3000 open?", "error");
      return null;
    }
  }

  // POST files to /compile/report → { combined, perFile } (or null).
  async function backendCompileReport(files) {
    var base = getBackendUrl();
    if (!base) return null;
    try {
      var res = await fetch(base + "/compile/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: files }),
      });
      if (!res.ok) { consoleLog("✗ backend error: HTTP " + res.status, "error"); return null; }
      return await res.json();
    } catch (err) {
      consoleLog("✗ backend unreachable (" + (err.message || err) + "). Is it running + port 3000 open?", "error");
      return null;
    }
  }

  // After the AI writes Verilog, compile-check EACH .v file on its own so one
  // broken file doesn't hide the status of the good ones.
  async function maybeBackendCompile(applied) {
    if (!getBackendUrl()) return;
    var wroteV = applied.some(function (n) { return isVerilogName(n.replace(/ \(new\)$/, "")); });
    if (!wroteV) return;
    var vfiles = files.filter(function (f) { return isVerilogName(f.name); })
      .map(function (f) { return { name: f.name, code: f.code || "" }; });
    if (!vfiles.length) return;
    consoleLog("$ iverilog (backend) — checking " + vfiles.length + " file(s) individually…", "cmd");
    var rep = await backendCompileReport(vfiles);
    if (!rep) return;
    var bad = 0;
    (rep.perFile || []).forEach(function (r) {
      if (r.kind === "syntax") {
        bad++;
        consoleLog("✗ " + r.name + ": syntax error — " + String(r.output || "").split("\n")[0], "error");
      } else if (r.kind === "needs-deps") {
        consoleLog("• " + r.name + ": parses OK (uses modules from other files)", "info");
      } else if (r.ok) {
        consoleLog("✓ " + r.name + ": compiled OK", "ok");
      } else {
        bad++;
        consoleLog("✗ " + r.name + ": " + String(r.output || "compile failed").split("\n")[0], "error");
      }
    });
    // Whole-project link status, as a summary line.
    if (rep.combined && rep.combined.ok) {
      consoleLog("✓ iverilog: whole project links OK", "ok");
    } else if (bad === 0 && rep.combined) {
      consoleLog("✗ iverilog: files parse, but the project doesn't link yet — " +
        String(rep.combined.output || "").split("\n")[0], "warn");
    }
  }

  toggleSidebarBtn.addEventListener("click", function () {
    appView.classList.toggle("sidebar-collapsed");
    document.body.classList.toggle("sidebar-collapsed", appView.classList.contains("sidebar-collapsed"));
    if (editor) editor.resize(); // let the editor reflow to the new width
  });

  // ---- AI chat widget (BYOK: OpenRouter, or a direct provider key) ----
  var chatHistory = []; // [{role, content, images?}] of the OPEN conversation
  var pendingImages = []; // data-URL images attached to the next message
  var currentConversationId = null; // null = unsaved new chat
  var conversations = []; // [{id, title, updated_at}] for the history list

  var PROVIDER_INFO = {
    openrouter: {
      model: "",
      hint: "Key from openrouter.ai/keys — works in the browser, one key for many models.",
      models: [
        "openai/gpt-4o-mini", "openai/gpt-4o",
        "anthropic/claude-3.5-sonnet", "anthropic/claude-3.5-haiku",
        "google/gemini-flash-1.5", "google/gemini-pro-1.5",
        "meta-llama/llama-3.3-70b-instruct", "deepseek/deepseek-chat",
      ],
    },
    openai: {
      model: "",
      hint: "Key from platform.openai.com. Note: OpenAI may block browser calls (CORS); if it errors, it needs a backend proxy.",
      models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1", "o3-mini"],
    },
    anthropic: {
      model: "",
      hint: "Key from console.anthropic.com — works in the browser.",
      models: ["claude-3-5-sonnet-latest", "claude-3-5-haiku-latest", "claude-3-opus-latest"],
    },
    google: {
      model: "",
      hint: "Key from aistudio.google.com/apikey.",
      models: ["gemini-3.5-flash", "gemini-3.1-flash-lite"],
    },
  };

  // --- Per-provider key/model storage (each LLM remembers its own key) ---
  function getConnections() {
    try { return JSON.parse(localStorage.getItem("llm_connections")) || []; }
    catch(e) { return []; }
  }
  function saveConnections(conns) { localStorage.setItem("llm_connections", JSON.stringify(conns)); }
  function getActiveConnectionId() { return localStorage.getItem("llm_active_connection_id"); }
  function setActiveConnectionId(id) { 
    if (id) localStorage.setItem("llm_active_connection_id", id);
    else localStorage.removeItem("llm_active_connection_id");
  }

  function currentProvider() { return localStorage.getItem("llm_provider") || "openrouter"; }
  
  function getProviderKey(p) {
    var conns = getConnections();
    var activeId = getActiveConnectionId();
    var active = conns.find(function(c) { return c.id === activeId; });
    if (active && active.provider === p) return active.key;
    var provConns = conns.filter(function(c) { return c.provider === p; });
    return provConns.length ? provConns[0].key : "";
  }

  function addConnection(p, k) {
    var conns = getConnections();
    var existing = conns.find(function(c) { return c.key === k && c.provider === p; });
    if (existing) {
      setActiveConnectionId(existing.id);
      return;
    }
    var id = Date.now().toString() + Math.floor(Math.random() * 1000);
    var count = conns.filter(function(c) { return c.provider === p; }).length + 1;
    var name = (p.charAt(0).toUpperCase() + p.slice(1)) + " " + count;
    conns.push({ id: id, provider: p, name: name, key: k });
    saveConnections(conns);
    setActiveConnectionId(id);
  }

  function getProviderModel(p) {
    return localStorage.getItem("llm_model_" + p) || (PROVIDER_INFO[p] || PROVIDER_INFO.openrouter).model;
  }
  function setProviderModel(p, m) { localStorage.setItem("llm_model_" + p, m); }
  function clearAllProviderKeys() {
    localStorage.removeItem("llm_connections");
    setActiveConnectionId(null);
  }

  // One-time migration from the old single-key storage to multiple connections.
  (function migrateKeys() {
    var conns = getConnections();
    var modified = false;
    
    // Check old single key
    var oldKey = localStorage.getItem("llm_api_key");
    var p = localStorage.getItem("llm_provider") || "openrouter";
    if (oldKey) {
      localStorage.setItem("llm_key_" + p, oldKey);
      localStorage.removeItem("llm_api_key");
    }

    // Migrate llm_key_xxx to connections
    Object.keys(PROVIDER_INFO).forEach(function(prov) {
      var k = localStorage.getItem("llm_key_" + prov);
      if (k) {
        if (!conns.some(function(c) { return c.key === k; })) {
          var id = Date.now().toString() + Math.floor(Math.random() * 1000);
          conns.push({
            id: id,
            provider: prov,
            name: (prov.charAt(0).toUpperCase() + prov.slice(1)) + " 1",
            key: k
          });
          modified = true;
          if (!getActiveConnectionId()) setActiveConnectionId(id);
        }
        localStorage.removeItem("llm_key_" + prov);
      }
    });
    if (modified) saveConnections(conns);
  })();

  function chatHasKey() { return !!getProviderKey(currentProvider()); }

  function updateProviderUI() {
    var p = chatProvider.value;
    var info = PROVIDER_INFO[p] || PROVIDER_INFO.openrouter;
    var hasKey = !!getProviderKey(p);
    chatSetupHint.textContent = hasKey
      ? "✓ You have a saved connection for this provider — click Connect, or paste a new key to add another."
      : info.hint;
    chatKeyInput.placeholder = hasKey ? "Paste a new key to add another" : "API key";
    renderSavedKeysList();
  }

  function maskKey(key) {
    if (!key) return "";
    if (key.length <= 8) return "••••••••";
    return key.slice(0, 3) + "••••••••" + key.slice(-4);
  }

  function renderSavedKeysList() {
    var conns = getConnections();
    chatSavedKeysList.innerHTML = "";
    
    var activeId = getActiveConnectionId();

    conns.forEach(function (c) {
      var item = document.createElement("div");
      item.className = "saved-key-item";
      if (c.id === activeId) item.classList.add("saved-key-active");
      
      var details = document.createElement("div");
      details.className = "saved-key-details";
      var provName = document.createElement("span");
      provName.className = "saved-key-provider";
      provName.textContent = c.name + " (" + (c.provider.charAt(0).toUpperCase() + c.provider.slice(1)) + ")";
      var masked = document.createElement("span");
      masked.className = "saved-key-masked";
      masked.textContent = maskKey(c.key);
      details.appendChild(provName);
      details.appendChild(masked);
      
      var actions = document.createElement("div");
      actions.className = "saved-key-actions";
      
      var switchBtn = document.createElement("button");
      switchBtn.className = "btn btn-small";
      if (c.id === activeId) {
        switchBtn.textContent = "Active";
        switchBtn.disabled = true;
      } else {
        switchBtn.textContent = "Use";
        switchBtn.addEventListener("click", function() {
          setActiveConnectionId(c.id);
          chatProvider.value = c.provider;
          localStorage.setItem("llm_provider", c.provider);
          updateProviderUI();
        });
      }

      var renameBtn = document.createElement("button");
      renameBtn.className = "btn btn-small";
      renameBtn.textContent = "Rename";
      renameBtn.addEventListener("click", function() {
        var newName = prompt("Enter a new name for this connection:", c.name);
        if (newName && newName.trim()) {
          var allConns = getConnections();
          var target = allConns.find(function(conn) { return conn.id === c.id; });
          if (target) {
            target.name = newName.trim();
            saveConnections(allConns);
            renderSavedKeysList();
          }
        }
      });
      
      var forgetBtn = document.createElement("button");
      forgetBtn.className = "btn btn-small";
      forgetBtn.textContent = "Forget";
      forgetBtn.addEventListener("click", function() {
        var allConns = getConnections();
        allConns = allConns.filter(function(conn) { return conn.id !== c.id; });
        saveConnections(allConns);
        if (c.id === activeId) setActiveConnectionId(null);
        if (chatProvider.value === c.provider && allConns.filter(function(conn) { return conn.provider === c.provider; }).length === 0) {
          chatKeyInput.value = "";
          setConnectedButtons(chatHasKey());
        }
        updateProviderUI();
      });
      
      actions.appendChild(switchBtn);
      actions.appendChild(renameBtn);
      actions.appendChild(forgetBtn);
      item.appendChild(details);
      item.appendChild(actions);
      chatSavedKeysList.appendChild(item);
    });
    chatSavedKeysContainer.classList.toggle("hidden", conns.length === 0);
  }

  function setConnectedButtons(show) {
    chatNew.classList.toggle("hidden", !show);
    chatHistoryBtn.classList.toggle("hidden", !show);
  }

  function showKeySetup() {
    chatProvider.value = localStorage.getItem("llm_provider") || "openrouter";
    updateProviderUI();
    chatWelcome.classList.add("hidden");
    chatKeySetup.classList.remove("hidden");
    chatHistoryView.classList.add("hidden");
    chatConversation.classList.add("hidden");
    chatModelBar.classList.add("hidden");
    chatInputRow.classList.add("hidden");
    chatAttachments.classList.add("hidden");
    // Keep the nav icons available if already connected, so the user can leave
    // the key screen without re-clicking "Save & connect".
    setConnectedButtons(chatHasKey());
  }

  // Fill the model dropdown with popular models for the chosen provider.
  function populateModelList(provider) {
    var models = (PROVIDER_INFO[provider] || PROVIDER_INFO.openrouter).models || [];
    chatModelList.innerHTML = "";
    models.forEach(function (m) {
      var opt = document.createElement("option");
      opt.value = m;
      chatModelList.appendChild(opt);
    });
  }

  // Show the active conversation (messages + model bar + input).
  function showConversation() {
    var provider = currentProvider();
    populateModelList(provider);
    chatModelCurrent.value = getProviderModel(provider);
    chatWelcome.classList.add("hidden");
    chatKeySetup.classList.add("hidden");
    chatHistoryView.classList.add("hidden");
    chatConversation.classList.remove("hidden");
    chatModelBar.classList.remove("hidden");
    chatInputRow.classList.remove("hidden");
    renderAttachments(); // reflect any attached spec chips
    setConnectedButtons(true);
    chatInput.focus();
  }

  // Show the saved-conversation list.
  function showHistory() {
    chatWelcome.classList.add("hidden");
    chatKeySetup.classList.add("hidden");
    chatConversation.classList.add("hidden");
    chatModelBar.classList.add("hidden");
    chatInputRow.classList.add("hidden");
    chatAttachments.classList.add("hidden");
    chatHistoryView.classList.remove("hidden");
    setConnectedButtons(true);
    loadConversations();
  }

  // True if ANY provider has a saved key.
  function hasAnyKey() {
    return Object.keys(PROVIDER_INFO).some(function (p) { return !!getProviderKey(p); });
  }

  // No keys at all: just a "get started" message + OK button.
  function showWelcome() {
    chatWelcome.classList.remove("hidden");
    chatKeySetup.classList.add("hidden");
    chatHistoryView.classList.add("hidden");
    chatConversation.classList.add("hidden");
    chatModelBar.classList.add("hidden");
    chatInputRow.classList.add("hidden");
    chatAttachments.classList.add("hidden");
    setConnectedButtons(false);
  }

  function renderChatView() {
    if (chatHasKey()) showConversation();
    else if (hasAnyKey()) showKeySetup();
    else showWelcome();
  }

  // ---- Conversation persistence (Supabase) ----
  function renderConversation() {
    chatConversation.innerHTML = "";
    chatHistory.forEach(function (m) { appendChatMsg(m.role, m.content); });
  }

  async function loadConversations() {
    var res = await dbListConversations();
    conversations = res.data || [];
    renderHistoryList();
    if (chatHistory.length === 0 && conversations.length > 0 && currentConversationId == null) {
      var lastId = localStorage.getItem("last_conversation_id");
      if (lastId && conversations.find(function(c) { return c.id === lastId; })) {
        openConversation(lastId);
      } else {
        openConversation(conversations[0].id);
      }
    }
  }

  function renderHistoryList() {
    chatHistoryList.innerHTML = "";
    chatHistoryEmpty.classList.toggle("hidden", conversations.length > 0);
    conversations.forEach(function (c) {
      var li = document.createElement("li");
      if (c.id === currentConversationId) li.classList.add("active");
      var title = document.createElement("span");
      title.className = "chat-history-title";
      title.textContent = c.title || "New chat";
      var ren = document.createElement("button");
      ren.className = "chat-history-act";
      ren.textContent = "✎";
      ren.title = "Rename chat";
      var del = document.createElement("button");
      del.className = "chat-history-act chat-history-del";
      del.textContent = "🗑";
      del.title = "Delete chat";
      li.appendChild(title);
      li.appendChild(ren);
      li.appendChild(del);
      li.addEventListener("click", function () { openConversation(c.id); });
      ren.addEventListener("click", function (e) { e.stopPropagation(); renameConversation(c.id, c.title); });
      del.addEventListener("click", function (e) { e.stopPropagation(); deleteConversation(c.id); });
      chatHistoryList.appendChild(li);
    });
  }

  async function openConversation(id) {
    var res = await dbGetConversation(id);
    if (res.error || !res.data) { alert("Couldn't open that chat."); return; }
    currentConversationId = id;
    localStorage.setItem("last_conversation_id", id);
    chatHistory = Array.isArray(res.data.messages) ? res.data.messages : [];
    renderConversation();
    showConversation();
  }

  function newChat() {
    chatHistory = [];
    currentConversationId = null;
    localStorage.removeItem("last_conversation_id");
    chatConversation.innerHTML = "";
    showConversation();
  }

  async function saveConversation() {
    var provider = currentProvider();
    var model = getProviderModel(provider);
    if (currentConversationId == null) {
      var firstUser = chatHistory.find(function (m) { return m.role === "user"; });
      var title = ((firstUser && firstUser.content) || "New chat").slice(0, 60);
      var ins = await dbCreateConversation({ title: title, provider: provider, model: model, messages: chatHistory });
      if (!ins.error && ins.data) {
        currentConversationId = ins.data.id;
        localStorage.setItem("last_conversation_id", ins.data.id);
        loadConversations(); // refresh the list to show the new chat
      }
    } else {
      await dbUpdateConversation(currentConversationId, { provider: provider, model: model, messages: chatHistory });
    }
  }

  async function renameConversation(id, currentTitle) {
    var name = prompt("Rename chat:", currentTitle || "");
    if (name == null) return; // cancelled
    name = name.trim();
    if (!name) return;
    var res = await dbUpdateConversation(id, { title: name });
    if (res.error) { alert("Couldn't rename: " + res.error.message); return; }
    var c = conversations.find(function (x) { return x.id === id; });
    if (c) c.title = name;
    renderHistoryList();
  }

  async function deleteConversation(id) {
    if (!confirm("Delete this chat?")) return;
    await dbDeleteConversation(id);
    conversations = conversations.filter(function (c) { return c.id !== id; });
    if (currentConversationId === id) {
      currentConversationId = null;
      localStorage.removeItem("last_conversation_id");
      chatHistory = [];
      chatConversation.innerHTML = "";
    }
    renderHistoryList();
  }

  function appendChatMsg(role, text, images) {
    var div = document.createElement("div");
    div.className = "chat-msg " + role;
    if (images && images.length) {
      images.forEach(function (url) {
        var img = document.createElement("img");
        img.className = "chat-msg-img";
        img.src = url;
        div.appendChild(img);
      });
      if (text) {
        var t = document.createElement("div");
        t.textContent = text;
        div.appendChild(t);
      }
    } else {
      div.textContent = text;
    }
    chatConversation.appendChild(div);
    chatConversation.scrollTop = chatConversation.scrollHeight;
    return div;
  }

  // Split a data URL into media type + base64 data.
  function parseDataUrl(url) {
    var m = /^data:([^;]+);base64,(.*)$/.exec(url || "");
    return m ? { mediaType: m[1], data: m[2] } : { mediaType: "image/png", data: "" };
  }

  // Pending image attachments (thumbnails above the input).
  function renderAttachments() {
    chatAttachments.innerHTML = "";
    // Spec files attached to the chat (persist until removed).
    var specFiles = getSpecIds()
      .map(function (id) { return files.find(function (f) { return f.id === id; }); })
      .filter(Boolean);
    chatAttachments.classList.toggle(
      "hidden",
      pendingImages.length === 0 && specFiles.length === 0
    );
    specFiles.forEach(function (f) {
      var chip = document.createElement("div");
      chip.className = "chat-spec-chip";
      var label = document.createElement("span");
      label.className = "chat-spec-name";
      label.textContent = "📄 " + f.name;
      chip.appendChild(label);
      var rm = document.createElement("button");
      rm.type = "button";
      rm.textContent = "×";
      rm.title = "Detach spec";
      rm.addEventListener("click", function () {
        removeSpec(f.id);
        renderAttachments();
        updateSpecButton();
        renderFileList();
      });
      chip.appendChild(rm);
      chatAttachments.appendChild(chip);
    });
    pendingImages.forEach(function (url, i) {
      var wrap = document.createElement("div");
      wrap.className = "chat-attachment";
      var img = document.createElement("img");
      img.src = url;
      wrap.appendChild(img);
      var rm = document.createElement("button");
      rm.type = "button";
      rm.textContent = "×";
      rm.title = "Remove";
      rm.addEventListener("click", function () { pendingImages.splice(i, 1); renderAttachments(); });
      wrap.appendChild(rm);
      chatAttachments.appendChild(wrap);
    });
  }

  function openChat() {
    chatPanel.classList.remove("hidden");
    chatToggle.classList.add("hidden");
    renderChatView();
  }
  function closeChat() {
    chatPanel.classList.add("hidden");
    chatToggle.classList.remove("hidden");
  }

  async function saveChatKey() {
    var provider = chatProvider.value;
    var typed = chatKeyInput.value.trim();
    // Use a freshly-typed key, or fall back to this provider's remembered key.
    var key = typed || getProviderKey(provider);
    if (!key) { alert("Paste an API key for this provider first."); return; }
    
    var originalText = chatKeySave.textContent;
    chatKeySave.textContent = "Testing...";
    chatKeySave.disabled = true;

    try {
      var models = PROVIDER_INFO[provider].models;
      
      // Test all models for this provider in parallel. The first one to succeed wins.
      var successfulModel = await Promise.any(models.map(async function (m) {
        await callLLM(provider, key, m, "", [{ role: "user", content: "Hello" }]);
        return m;
      }));

      if (typed) addConnection(provider, typed); // create a new connection or set it active
      localStorage.setItem("llm_provider", provider);
      setProviderModel(provider, successfulModel); // Set the default to the one that actually worked
      chatKeyInput.value = "";
      renderChatView();
    } catch (err) {
      // Promise.any throws an AggregateError if all promises fail.
      var actualError = err;
      if (err.errors && err.errors.length > 0) {
        // If it was an authentication error (401/403), prioritize showing that over a generic 404
        actualError = err.errors.find(function(e) { return e.status === 401 || e.status === 403; }) || err.errors[0];
      }
      alert("Failed to connect to " + provider + ": " + (actualError.message || actualError));
    } finally {
      chatKeySave.textContent = originalText;
      chatKeySave.disabled = false;
    }
  }

  async function llmError(resp) {
    var e = await resp.json().catch(function () { return {}; });
    var m = (e.error && (e.error.message || e.error)) || e.message || ("HTTP " + resp.status);
    var err = new Error(typeof m === "string" ? m : JSON.stringify(m));
    err.status = resp.status;
    return err;
  }

  // Call the right endpoint for the chosen provider; return the reply text.
  // `system` carries the project files + edit instructions (handled per provider).
  async function callLLM(provider, key, model, system, history) {
    if (provider === "anthropic") {
      var amsgs = history.map(function (m) {
        if (m.images && m.images.length) {
          var parts = m.images.map(function (url) {
            var d = parseDataUrl(url);
            return { type: "image", source: { type: "base64", media_type: d.mediaType, data: d.data } };
          });
          if (m.content) parts.push({ type: "text", text: m.content });
          return { role: m.role, content: parts };
        }
        return { role: m.role, content: m.content };
      });
      var abody = { model: model, max_tokens: 8192, messages: amsgs };
      if (system) abody.system = system;
      var ar = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(abody),
      });
      if (!ar.ok) throw await llmError(ar);
      var ad = await ar.json();
      return (ad.content && ad.content[0] && ad.content[0].text) || "(no response)";
    }
    if (provider === "google") {
      var gurl = "https://generativelanguage.googleapis.com/v1beta/models/" +
        encodeURIComponent(model) + ":generateContent?key=" + encodeURIComponent(key);
      var contents = history.map(function (m) {
        var parts = [];
        if (m.images) m.images.forEach(function (url) {
          var d = parseDataUrl(url);
          parts.push({ inline_data: { mime_type: d.mediaType, data: d.data } });
        });
        if (m.content) parts.push({ text: m.content });
        if (!parts.length) parts.push({ text: "" });
        return { role: m.role === "assistant" ? "model" : "user", parts: parts };
      });
      var gbody = { contents: contents };
      if (system) gbody.systemInstruction = { parts: [{ text: system }] };
      var gr = await fetch(gurl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(gbody),
      });
      if (!gr.ok) throw await llmError(gr);
      var gd = await gr.json();
      return (gd.candidates && gd.candidates[0] && gd.candidates[0].content &&
        gd.candidates[0].content.parts[0] && gd.candidates[0].content.parts[0].text) || "(no response)";
    }
    // openrouter (default) or openai — both use the OpenAI chat-completions shape
    var endpoint = provider === "openai"
      ? "https://api.openai.com/v1/chat/completions"
      : "https://openrouter.ai/api/v1/chat/completions";
    var histMsgs = history.map(function (m) {
      if (m.images && m.images.length) {
        var parts = [];
        if (m.content) parts.push({ type: "text", text: m.content });
        m.images.forEach(function (url) { parts.push({ type: "image_url", image_url: { url: url } }); });
        return { role: m.role, content: parts };
      }
      return { role: m.role, content: m.content };
    });
    var msgs = system ? [{ role: "system", content: system }].concat(histMsgs) : histMsgs;
    var or = await fetch(endpoint, {
      method: "POST",
      headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({ model: model, messages: msgs }),
    });
    if (!or.ok) throw await llmError(or);
    var od = await or.json();
    return (od.choices && od.choices[0] && od.choices[0].message.content) || "(no response)";
  }

  // Build the system context: the selected project's files + edit instructions.
  // Track each file's content as of the last SUCCESSFUL send, so later messages
  // send only the delta (unchanged files go as an interface-only index). Snapshot
  // is committed after a send succeeds, so a failed send re-sends everything full.
  var sentFullSnapshot = {};
  function snapshotSentFiles() {
    files.forEach(function (f) { sentFullSnapshot[f.id] = f.code || ""; });
  }
  // Parse an on-demand "NEED: a.v, b.v" request from the model's reply.
  function parseNeedRequest(text) {
    var m = (text || "").match(/^\s*NEED:\s*(.+)$/mi);
    if (!m) return [];
    return m[1].split(",").map(function (s) { return s.trim().replace(/[`'"]/g, ""); }).filter(Boolean);
  }
  // Build a user message that supplies the full bodies of the requested files.
  function provideRequestedFiles(names) {
    var parts = names.map(function (nm) {
      var f = files.find(function (x) { return (x.name || "") === nm; });
      return f ? ("--- " + f.name + " (full) ---\n" + (f.code || "")) : ("--- " + nm + " ---\n(no such file)");
    });
    return "Here are the full contents of the files you requested:\n\n" + parts.join("\n\n") + "\n\nNow continue with the task.";
  }

  // Pull just the module header(s) (name + ports) out of Verilog, body omitted.
  function extractInterface(code) {
    var out = [];
    var re = /\bmodule\s+\w+[\s\S]*?\)\s*;/g;
    var m;
    while ((m = re.exec(code || ""))) out.push(m[0] + "\n  // ...body omitted (unchanged)...\nendmodule");
    return out.length ? out.join("\n\n") : "// (interface unavailable)";
  }

  // Decide whether a file is sent in FULL this message, or just as an index.
  // Full: specs, the open file, small files, and anything CHANGED since last full send.
  function shouldSendFull(f) {
    var code = f.code || "";
    if (isSpec(f.id)) return true;                    // the design spec — source of truth
    if (f.id === currentFileId) return true;          // the file the user is on
    if (code.length < 400) return true;               // tiny — cheap to always send
    if (sentFullSnapshot[f.id] !== code) return true; // changed since we last sent it full
    return false;                                     // unchanged + large → index only
  }

  function buildProjectContext() {
    syncCurrentFileFromEditor(); // include unsaved edits of the open file
    var lines = [
      "You are an AI assistant embedded in a Verilog IDE. You can read and edit the files of the user's currently selected project.",
      "",
      "PROJECT: " + (projectNameInput.value.trim() || "Untitled"),
      "FILES:",
    ];
    if (!files.length) {
      lines.push("(no files yet)");
    } else {
      var indexed = 0;
      files.forEach(function (f) {
        var full = shouldSendFull(f);
        lines.push("");
        if (full) {
          lines.push("--- " + (f.name || "untitled.v") + " ---");
          lines.push(f.code || "");
        } else if (isVerilogName(f.name)) {
          lines.push("--- " + f.name + " (interface only — unchanged) ---");
          lines.push(extractInterface(f.code));
          indexed++;
        } else {
          lines.push("--- " + f.name + " (unchanged, " + (f.code || "").length + " chars, body omitted) ---");
          indexed++;
        }
      });
      if (indexed) {
        lines.push("");
        lines.push("NOTE: Files marked '(interface only)'/'(body omitted)' are UNCHANGED — only their interface is shown to save space. If you need the FULL body of one (or more) before you can proceed, reply with a SINGLE line exactly: 'NEED: <filename>[, <filename>...]' and nothing else; the full files will be provided and you can continue. To edit a file, output its full ```file:<name>``` block.");
      }
    }
    lines.push("");
    lines.push("To CREATE or EDIT a file, output a fenced code block in EXACTLY this format, containing the FULL new contents of the file (never a diff or partial file):");
    lines.push("```file:<filename>");
    lines.push("<full new file contents>");
    lines.push("```");
    lines.push("CRITICAL: Do NOT use nested markdown code blocks (like ```mermaid or ```verilog) inside your file contents! Write raw text only.");
    lines.push("Only include a file block when you actually want to change that file. You may add explanation around the blocks.");
    lines.push("If you create or designate the top-level module, add a line exactly: TOP: <filename>");
    lines.push("");
    lines.push("SPEC FILE: Maintain the design specification in a Markdown file. Use an existing .md spec file if one is present; otherwise create 'spec.md'.");
    lines.push("- If the user describes a design in a prompt (rather than pointing to an existing spec file), FIRST write/update the spec .md capturing the requirements, then implement the Verilog modules.");
    lines.push("- Whenever requirements change or you make notable design decisions, update the spec .md so it stays accurate. Write it with the same file-block format (```file:spec.md```).");
    lines.push("");
    lines.push("DEPENDENCY GRAPH: When you decompose a design (from a prompt or a spec), ALSO create/maintain a file 'dependency_graph.md' that contains, in this order:");
    lines.push("1. FUNCTIONALITIES — each functional area of the design, and a bullet list of the Verilog modules that together make up that functionality.");
    lines.push("2. MODULES — each module, a one-line purpose, and the modules it depends on (directly instantiates); write 'depends on: none' for leaf modules.");
    lines.push("3. A Mermaid diagram in a fenced ```mermaid code block starting with 'graph TD', where an edge 'A --> B' means module A instantiates module B.");
    lines.push("Update dependency_graph.md whenever the module structure or dependencies change, using the same ```file:dependency_graph.md``` block format.");
    return lines.join("\n");
  }

  // Pull file edits out of the AI's reply ( ```file:NAME ... ``` blocks ).
  function parseFileEdits(text) {
    var edits = [];
    var re = /```file:([^\n`]+)\r?\n([\s\S]*?)```/g;
    var m;
    while ((m = re.exec(text)) !== null) {
      var name = m[1].trim();
      var content = m[2].replace(/\r?\n$/, "");
      if (name) edits.push({ name: name, content: content });
    }
    return edits;
  }

  // Replace the file blocks in the displayed reply with a short marker.
  function stripFileBlocks(text) {
    return text.replace(/```file:([^\n`]+)\r?\n[\s\S]*?```/g, function (_, name) {
      return "〔updated " + name.trim() + "〕";
    });
  }

  // Apply the AI's edits to the project: update existing files / create new ones.
  async function applyFileEdits(edits) {
    var applied = [];
    for (var i = 0; i < edits.length; i++) {
      var name = edits[i].name;
      var content = edits[i].content;
      var existing = files.find(function (f) { return f.name === name; });
      if (existing) {
        var ures = await dbUpdateFile(existing.id, { name: name, code: content });
        if (!ures.error) {
          existing.code = content; applied.push(name); consoleLog("🤖 updated " + name, "info");
          if (/^spec\.md$/i.test(name) && !isSpec(existing.id)) addSpec(existing.id);
        } else {
          consoleLog("Failed to update " + name + ": " + ures.error.message, "error");
        }
      } else {
        var ires = await dbCreateFile(currentProjectId, name, content);
        if (!ires.error) {
          files.push(ires.data); applied.push(name + " (new)"); consoleLog("🤖 created " + name, "ok");
          if (/^spec\.md$/i.test(name) && !isSpec(ires.data.id)) addSpec(ires.data.id);
        } else {
          consoleLog("Failed to create " + name + ": " + ires.error.message, "error");
        }
      }
    }
    files.sort(function (a, b) { return (a.name || "").localeCompare(b.name || ""); });
    renderFileList();
    updateSpecButton(); // reflect any auto-set spec
    // Refresh the editor if the currently-open file was changed.
    if (currentFileId != null && editor) {
      var cur = files.find(function (f) { return f.id === currentFileId; });
      if (cur) editor.setValue(cur.code || "", -1);
    }
    maybeBackendCompile(applied); // iverilog compile-check on the EC2 backend (if configured)
    return applied;
  }

  async function sendChat() {
    var provider = currentProvider();
    var key = getProviderKey(provider);
    if (!key) { renderChatView(); return; }
    var text = chatInput.value.trim();
    var imgs = pendingImages.slice();
    if (!text && !imgs.length) return;

    var ok = await ensureProject(text || "New AI Project", imgs);
    if (!ok) return;
    chatInput.value = "";
    pendingImages = [];
    renderAttachments();
    appendChatMsg("user", text, imgs);
    chatHistory.push({ role: "user", content: text, images: imgs });

    var bubble = appendChatMsg("assistant", "…");
    chatSend.disabled = true;
    try {
      var model = getProviderModel(provider);
      if (!model) throw new Error("No model selected. Please pick a model from the dropdown above.");
      var system = buildProjectContext();
      var reply = await callLLM(provider, key, model, system, chatHistory);
      // The model now has the current file contents (full for changed, interface
      // for unchanged) — record them so the NEXT message only sends the delta.
      snapshotSentFiles();

      // On-demand fetch: if the model asks 'NEED: <files>', supply their full
      // bodies and let it continue. Capped to avoid loops.
      var fetchRounds = 0;
      var needed = parseNeedRequest(reply);
      while (needed.length && fetchRounds < 2) {
        fetchRounds++;
        chatHistory.push({ role: "assistant", content: reply }); // the NEED request
        chatHistory.push({ role: "user", content: provideRequestedFiles(needed) });
        consoleLog("📎 sent full: " + needed.join(", ") + " (model requested)", "info");
        bubble.textContent = "📎 fetching " + needed.join(", ") + "…";
        reply = await callLLM(provider, key, model, system, chatHistory);
        needed = parseNeedRequest(reply);
      }

      var displayReply = stripFileBlocks(reply);
      bubble.textContent = displayReply;
      chatHistory.push({ role: "assistant", content: displayReply });

      // Apply any file edits the AI proposed.
      var edits = parseFileEdits(reply);
      if (edits.length) {
        if (currentProjectId == null) {
          appendChatMsg("assistant", "⚠ Open a project first so I can save file edits.")
            .classList.add("chat-error");
        } else {
          var applied = await applyFileEdits(edits);
          if (applied.length) {
            appendChatMsg("assistant", "✎ Updated " + applied.length + " file(s): " + applied.join(", "));
          }
          if (applied.length < edits.length) {
            appendChatMsg("assistant", "⚠ Failed to save some files. Check the Console for details.").classList.add("chat-error");
          }
          applyAiTopDeclaration(reply);
        }
      }

      // Persist the conversation (non-fatal if it fails).
      try { await saveConversation(); } catch (e) { /* ignore save errors */ }
    } catch (err) {
      bubble.textContent = "Error: " + (err.message || err);
      bubble.classList.add("chat-error");
    } finally {
      chatSend.disabled = false;
      chatConversation.scrollTop = chatConversation.scrollHeight;
    }
  }

  chatToggle.addEventListener("click", openChat);
  chatClose.addEventListener("click", closeChat);
  chatNew.addEventListener("click", newChat);
  chatHistoryBtn.addEventListener("click", function () {
    if (chatHistoryView.classList.contains("hidden")) showHistory();
    else showConversation();
  });
  chatExpand.addEventListener("click", function () {
    var expanded = chatPanel.classList.toggle("expanded");
    chatExpand.textContent = expanded ? "⤡" : "⤢";
    chatExpand.title = expanded ? "Shrink" : "Expand";
  });
  chatSettings.addEventListener("click", function () {
    // If we're already on the key screen and connected, go back to the chat
    // (no need to re-enter the saved key); otherwise open the key screen.
    if (!chatKeySetup.classList.contains("hidden") && chatHasKey()) {
      showConversation();
    } else {
      showKeySetup();
    }
  });
  chatProvider.addEventListener("change", updateProviderUI);
  chatWelcomeOk.addEventListener("click", showKeySetup);
  chatKeySave.addEventListener("click", saveChatKey);
  
  // Change the model on the fly (no need to re-enter the key)
  chatModelCurrent.addEventListener("change", function () {
    var provider = currentProvider();
    var m = chatModelCurrent.value.trim() || PROVIDER_INFO[provider].model;
    chatModelCurrent.value = m;
    setProviderModel(provider, m);
  });
  // Sending a prompt runs the Verifier → approval → Builder flow every time.
  chatSend.addEventListener("click", startVerifierFlow);
  chatInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); startVerifierFlow(); }
  });
  function addImageFile(file) {
    if (!file || (file.type || "").indexOf("image/") !== 0) return;
    var reader = new FileReader();
    reader.onload = function () { pendingImages.push(reader.result); renderAttachments(); };
    reader.readAsDataURL(file);
  }
  chatAttachBtn.addEventListener("click", function () {
    chatImageInput.value = "";
    chatImageInput.click();
  });
  chatImageInput.addEventListener("change", function () {
    if (!chatImageInput.files) return;
    Array.prototype.forEach.call(chatImageInput.files, addImageFile);
  });
  // Paste an image straight into the box (e.g. a screenshot).
  chatInput.addEventListener("paste", function (e) {
    var items = (e.clipboardData && e.clipboardData.items) || [];
    var found = false;
    for (var i = 0; i < items.length; i++) {
      if (items[i].type && items[i].type.indexOf("image/") === 0) {
        addImageFile(items[i].getAsFile());
        found = true;
      }
    }
    if (found) e.preventDefault(); // don't also paste the image as raw text/data
  });

  function isVerilogName(name) { return /\.(v|sv|svh|vh)$/i.test(name || ""); }

  // ---- Generate a whole-project testbench: the Verifier writes one against the
  // spec, saves it into Files, and runs it. (To use your own, just Import a file.)
  if (generateTbBtn) generateTbBtn.addEventListener("click", async function () {
    if (moreMenu) moreMenu.classList.add("hidden");
    if (currentProjectId == null) { alert("Open a project first."); return; }
    var base = getBackendUrl();
    if (!base) { alert("Set a backend first (Console → ⚙ Backend)."); return; }
    var provider = currentProvider();
    var key = getProviderKey(provider);
    if (!key) { alert("Connect an LLM first (add an API key in the LLM panel)."); return; }
    syncCurrentFileFromEditor();
    var vfiles = files.filter(function (f) { return isVerilogName(f.name); })
      .map(function (f) { return { name: f.name, code: f.code || "" }; });
    if (!vfiles.length) { alert("No Verilog files to test yet."); return; }
    // Assemble the spec from any files marked as specs (or a spec.md).
    var specFiles = getSpecIds()
      .map(function (id) { return files.find(function (f) { return f.id === id; }); })
      .filter(Boolean);
    if (!specFiles.length) {
      var sm = files.find(function (f) { return /^spec\.md$/i.test(f.name); });
      if (sm) specFiles = [sm];
    }
    var specText = specFiles.map(function (s) { return s.code || ""; }).join("\n\n");

    generateTbBtn.disabled = true;
    consoleLog("🤖 Verifier is writing a whole-project testbench…", "info");
    try {
      var resp = await fetch(base + "/testbench", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: vfiles, spec: specText, provider: provider, key: key, model: getProviderModel(provider) }),
      });
      var data = await resp.json();
      if (data.error) { consoleLog("✗ testbench: " + data.error, "error"); return; }
      var name = uniqueFileName(data.name || "project_tb.v");
      var cres = await dbCreateFile(currentProjectId, name, data.code || "");
      if (!cres.error) {
        files.push(cres.data);
        files.sort(function (a, b) { return (a.name || "").localeCompare(b.name || ""); });
        renderFileList();
        openFile(cres.data.id);
        consoleLog("🧪 wrote " + name + " (whole-project testbench)", "ok");
      }
      if (data.passed === true) consoleLog("✓ project testbench: PASSED ✓", "ok");
      else if (data.passed === false) consoleLog("✗ project testbench: FAILED ✗" + (data.output ? " — " + String(data.output).split(";")[0] : ""), "error");
      else consoleLog("• project testbench: inconclusive (couldn't run) " + (data.output || ""), "warn");
    } catch (e) {
      consoleLog("✗ testbench: couldn't reach the backend — " + ((e && e.message) || e), "error");
    } finally {
      generateTbBtn.disabled = false;
    }
  });
  // Run the CURRENTLY OPEN testbench against the whole project with the simulator
  // (vvp) and show the real result — for imported / hand-written testbenches.
  // Run simulation compiles the currently-open file + the files defining every
  // module it instantiates (transitively) and runs it with vvp — whatever the
  // current file is. No testbench assumption, no cross-project top detection.
  // Disabled for non-Verilog files — see collectSimFiles / updateRunSimButton.
  if (runSimBtn) runSimBtn.addEventListener("click", async function () {
    if (moreMenu) moreMenu.classList.add("hidden");
    if (currentProjectId == null) return;
    var base = getBackendUrl();
    if (!base) { alert("Set a backend first (Console → ⚙ Backend)."); return; }
    syncCurrentFileFromEditor();
    var name = fileNameInput.value.trim();
    var code = editor ? editor.getValue() : "";
    if (!isVerilogName(name)) return; // shouldn't happen (button disabled)
    // Compile the current file + the files defining every module it instantiates
    // (transitively). Not tied to "testbench" — runs whatever file is open.
    var vfiles = collectSimFiles(name, code);
    runSimBtn.disabled = true;
    var depCount = vfiles.length - 1;
    consoleLog("▶ simulating " + name + (depCount > 0 ? " + " + depCount + " dependency file(s)" : "") + " (vvp)…", "info");
    try {
      var resp = await fetch(base + "/testbench/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: vfiles }),
      });
      var data = await resp.json();
      if (data.error) { consoleLog("✗ simulation: " + data.error, "error"); return; }
      var out = String(data.output || "").trim();
      if (data.compileFailed) {
        consoleLog("✗ simulation: won't compile — check that every module " + name + " instantiates exists in the project (and the names match)", "error");
      } else if (data.passed === true) {
        consoleLog("✓ simulation PASSED ✓", "ok");
      } else if (data.passed === false) {
        consoleLog("✗ simulation FAILED ✗", "error");
      } else if (out) {
        consoleLog("• simulation ran — no clear PASS/FAIL marker; read the output below", "warn");
      } else {
        consoleLog("• simulation ran but produced NO output — the file printed nothing ($display/$monitor).", "warn");
      }
      if (out) {
        consoleLog("── simulation output ──", "info");
        out.split("\n").forEach(function (ln) { consoleLog("   " + ln, "log"); });
      }
    } catch (e) {
      consoleLog("✗ simulation: couldn't reach the backend — " + ((e && e.message) || e), "error");
    } finally {
      updateRunSimButton(); // re-enable per current-file state
    }
  });
  updateRunSimButton(); // initial state (disabled until a runnable file is open)
  // ---- Synthesize the WHOLE project with yosys (the final step) --------------
  // Run this once the LLMs have finished building and verifying: it takes the
  // assembled design (testbenches excluded automatically), runs the full yosys
  // synthesis flow, and reports the gate-level result — cells, flip-flops, logic
  // depth — saving the netlist into the project as netlist.v. No LLM involved.
  if (synthProjectBtn) synthProjectBtn.addEventListener("click", async function () {
    if (moreMenu) moreMenu.classList.add("hidden");
    if (currentProjectId == null) { alert("Open a project first."); return; }
    var base = getBackendUrl();
    if (!base) { alert("Set a backend first (Console → ⚙ Backend)."); return; }
    syncCurrentFileFromEditor();
    var vfiles = files.filter(function (f) { return isVerilogName(f.name) && f.name !== "netlist.v"; })
      .map(function (f) { return { name: f.name, code: f.code || "" }; });
    if (!vfiles.length) { alert("No Verilog files to synthesize yet."); return; }

    synthProjectBtn.disabled = true;
    consoleLog("⚙ synthesizing the whole project with yosys…", "info");
    try {
      var topMod = selectedTopModule(); // honor the user's chosen TOP file
      if (topMod) consoleLog("   • top module: " + topMod + " (from your TOP selection)", "log");
      var resp = await fetch(base + "/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(topMod ? { files: vfiles, top: topMod } : { files: vfiles }),
      });
      var data = await resp.json();
      if (data.error) { consoleLog("✗ synthesis: " + data.error, "error"); return; }

      if (data.excluded && data.excluded.length)
        consoleLog("   • excluded from synthesis (testbenches): " + data.excluded.join(", "), "log");

      if (!data.ok) {
        consoleLog("✗ synthesis FAILED ✗" + (data.top ? " (top: " + data.top + ")" : ""), "error");
        (data.errors || []).forEach(function (e) { consoleLog("   " + e, "error"); });
        if (data.output) {
          consoleLog("── yosys log (tail) ──", "info");
          String(data.output).split("\n").slice(-25).forEach(function (ln) { consoleLog("   " + ln, "log"); });
        }
        return;
      }

      var s = data.stats || {};
      consoleLog("✓ synthesis PASSED ✓ — top module: " + data.top, "ok");
      consoleLog("   • cells: " + (s.cells != null ? s.cells : "?") +
        "  |  flip-flops: " + (s.flipFlops != null ? s.flipFlops : "?") +
        "  |  wires: " + (s.wires != null ? s.wires : "?"), "log");
      if (data.longestPath != null)
        consoleLog("   • longest combinational path: " + data.longestPath + " logic levels (rough depth — lower means a faster clock)", "log");
      if (s.area != null) {
        consoleLog("   • chip area: " + s.area + " µm²" + (data.technology ? " (" + data.technology + ")" : ""), "ok");
        if (s.gateEquivalents != null)
          consoleLog("     (≈ " + s.gateEquivalents.toLocaleString() + " gate-equivalents)", "log");
      } else if (s.gateEquivalents != null) {
        consoleLog("   • area ≈ " + s.gateEquivalents.toLocaleString() + " gate-equivalents (estimate — no cell library on the backend; add one for real µm²)", "log");
      }
      if (s.memoryBits) consoleLog("   • inferred memory: " + s.memoryBits + " bits", "log");
      if (s.cellTypes && s.cellTypes.length) {
        var top5 = s.cellTypes.slice().sort(function (a, b) { return b.count - a.count; }).slice(0, 6);
        consoleLog("   • gate mix: " + top5.map(function (c) { return c.name + "×" + c.count; }).join(", "), "log");
      }
      (data.warnings || []).slice(0, 8).forEach(function (w) { consoleLog("   ⚠ " + w, "warn"); });

      // Save the netlist into the project — overwrite the previous one rather
      // than piling up netlist(1).v, netlist(2).v … on every re-synthesis.
      if (data.netlist) {
        var existing = files.find(function (f) { return f.name === "netlist.v"; });
        if (existing) {
          var ures = await dbUpdateFile(existing.id, { name: "netlist.v", code: data.netlist });
          if (!ures.error) { existing.code = data.netlist; consoleLog("📦 updated netlist.v (gate-level netlist)", "ok"); }
        } else {
          var cres = await dbCreateFile(currentProjectId, "netlist.v", data.netlist);
          if (!cres.error) {
            files.push(cres.data);
            files.sort(function (a, b) { return (a.name || "").localeCompare(b.name || ""); });
            renderFileList();
            consoleLog("📦 wrote netlist.v (gate-level netlist)", "ok");
          }
        }
      }
    } catch (e) {
      consoleLog("✗ synthesis: couldn't reach the backend — " + ((e && e.message) || e), "error");
    } finally {
      synthProjectBtn.disabled = false;
    }
  });

  // Ask the LLM which file holds the top-level DESIGN module (not a testbench).
  async function detectTopWithAI() {
    if (currentProjectId == null) { alert("Open a project first."); return; }
    var provider = currentProvider();
    var key = getProviderKey(provider);
    if (!key) { alert("Connect an LLM first — open the assistant (💬) and add an API key."); return; }
    syncCurrentFileFromEditor();
    var vfiles = files.filter(function (f) { return isVerilogName(f.name); });
    if (!vfiles.length) { alert("No Verilog files to analyze."); return; }

    var sys = "You analyze a Verilog project and identify the TOP-LEVEL DESIGN module — the root of the design hierarchy, NOT a testbench. " +
      "Ignore testbenches entirely when judging connectivity: multiple independent testbenches do NOT make the project 'disconnected' — a project commonly has one design plus several testbenches for it. " +
      "Consider only the non-testbench (design) modules. If they reduce to a single root design module (one not instantiated by any other design module), reply with ONLY that file's filename. " +
      "Only reply with exactly NONE if there are multiple genuinely separate, unconnected DESIGN modules (not testbenches).";
    var userMsg = "Which file holds the top-level design module (not a testbench)?\n\n";
    vfiles.forEach(function (f) { userMsg += "--- " + f.name + " ---\n" + (f.code || "") + "\n\n"; });

    var prev = detectTopBtn.textContent;
    detectTopBtn.disabled = true;
    detectTopBtn.textContent = "…";
    try {
      var model = getProviderModel(provider);
      var reply = await callLLM(provider, key, model, sys, [{ role: "user", content: userMsg }]);
      var clean = (reply || "").trim();
      if (/^none\b/i.test(clean)) { alert("No top module found."); return; }
      var f = vfiles.find(function (x) { return x.name === clean; });
      if (!f) {
        var mentioned = vfiles.filter(function (x) { return x.name && clean.indexOf(x.name) !== -1; });
        var nonTb = mentioned.filter(function (x) { return x.name.toLowerCase().indexOf("tb_") !== 0; });
        f = nonTb[0] || mentioned[0];
      }
      if (!f) { consoleLog("🔎 no top module found", "warn"); alert("No top module found."); return; }
      setDeclaredTop(f.id, "user");
      renderFileList();
      consoleLog("🔎 top module: " + f.name, "ok");
    } catch (err) {
      alert("Couldn't detect top: " + (err.message || err));
    } finally {
      detectTopBtn.disabled = false;
      detectTopBtn.textContent = prev;
    }
  }

  detectTopBtn.addEventListener("click", detectTopWithAI);

  signOutBtn.addEventListener("click", function () { sb.auth.signOut(); });
  if (signInBtn) signInBtn.addEventListener("click", openSignIn);
  if (authGuestLink) authGuestLink.addEventListener("click", function (e) {
    e.preventDefault();
    enterApp(null); // return to guest mode
  });

  // ---------------------------------------------------------------------------
  // Session bootstrap — no forced sign-in. Guests get the app immediately
  // (localStorage); signing in switches to the cloud account.
  // ---------------------------------------------------------------------------
  var lastUserId = undefined;
  sb.auth.onAuthStateChange(function (_event, session) {
    // Security: drop saved API keys when the user signs out, so a shared
    // browser doesn't leave one user's keys available to the next.
    if (_event === "SIGNED_OUT") clearAllProviderKeys();
    var uid = session ? session.user.id : null;
    if (uid === lastUserId) return;
    lastUserId = uid;
    enterApp(session); // session may be null → guest mode
  });
})();
