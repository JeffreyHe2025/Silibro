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
  var chatHistoryNew = $("chat-history-new");
  var chatHistoryBtn = $("chat-history");
  var chatHistoryView = $("chat-history-view");
  var chatHistoryList = $("chat-history-list");
  var chatHistoryEmpty = $("chat-history-empty");

  var authForm = $("auth-form");
  var authTitle = $("auth-title");
  var authEmail = $("auth-email");
  var authPassword = $("auth-password");
  var authShow = $("auth-show");
  var authConfirm = $("auth-confirm");
  var authConfirmShow = $("auth-confirm-show");
  var authConfirmField = $("auth-confirm-field");
  var authSubmit = $("auth-submit");
  var authMessage = $("auth-message");
  var authToggleText = $("auth-toggle-text");
  var authToggleLink = $("auth-toggle-link");
  var authForgotRow = $("auth-forgot-row");
  var authForgotLink = $("auth-forgot-link");

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
      authConfirmField.classList.remove("hidden"); // confirm-password only on signup
      if (authForgotRow) authForgotRow.classList.add("hidden"); // forgot only on sign-in
    } else {
      authTitle.textContent = "Sign in";
      authSubmit.textContent = "Sign in";
      authToggleText.textContent = "Don't have an account?";
      authToggleLink.textContent = "Sign up";
      authPassword.setAttribute("autocomplete", "current-password");
      authConfirmField.classList.add("hidden");
      if (authForgotRow) authForgotRow.classList.remove("hidden");
    }
    if (authConfirm) authConfirm.value = "";
    hidePw(authPassword, authShow);   // default OFF every time the form is shown
    hidePw(authConfirm, authConfirmShow);
    setAuthMessage("");
  }

  // Reset a password field back to hidden ("show password" default off).
  function hidePw(input, btn) {
    if (input) input.type = "password";
    if (btn) {
      btn.classList.remove("on");
      btn.setAttribute("aria-label", "Show password");
      btn.title = "Show password";
    }
  }
  // Toggle one password field's visibility (each eye controls only its own field).
  function wirePwToggle(input, btn) {
    if (!input || !btn) return;
    btn.addEventListener("click", function () {
      var reveal = input.type === "password";
      input.type = reveal ? "text" : "password";
      btn.classList.toggle("on", reveal);
      btn.setAttribute("aria-label", reveal ? "Hide password" : "Show password");
      btn.title = reveal ? "Hide password" : "Show password";
    });
  }
  wirePwToggle(authPassword, authShow);
  wirePwToggle(authConfirm, authConfirmShow);

  authToggleLink.addEventListener("click", function (e) {
    e.preventDefault();
    setAuthMode(authMode === "signin" ? "signup" : "signin");
  });

  // Forgot password: email the user a reset link that lands on /reset/.
  if (authForgotLink) {
    authForgotLink.addEventListener("click", function (e) {
      e.preventDefault();
      var email = authEmail.value.trim();
      if (!email) { setAuthMessage("Enter your email above first, then click “Forgot password?”.", "error"); authEmail.focus(); return; }
      setAuthMessage("Sending reset link…", "info");
      sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + "/reset/" }).then(function (res) {
        if (res.error) { setAuthMessage(res.error.message, "error"); return; }
        setAuthMessage("📧 If an account exists for " + email + ", we've sent a password-reset link. Check your inbox (and spam).", "success");
      });
    });
  }

  authForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var email = authEmail.value.trim();
    var password = authPassword.value;
    if (!email || !password) return;

    // Sign up: require the password to be typed twice and match.
    if (authMode === "signup") {
      if (password.length < 6) { setAuthMessage("Password must be at least 6 characters.", "error"); return; }
      if (authConfirm.value !== password) { setAuthMessage("Passwords don't match.", "error"); authConfirm.focus(); return; }
    }

    authSubmit.disabled = true;
    setAuthMessage(authMode === "signup" ? "Creating account…" : "Signing in…", "info");

    var op =
      authMode === "signup"
        ? sb.auth.signUp({ email: email, password: password, options: { emailRedirectTo: location.origin + "/confirmed/" } })
        : sb.auth.signInWithPassword({ email: email, password: password });

    op.then(function (res) {
      authSubmit.disabled = false;
      if (res.error) {
        var em = res.error.message || "Something went wrong.";
        if (/email not confirmed|not confirmed/i.test(em)) {
          em = "Please confirm your email first — check your inbox (and spam) for the verification link we sent, then sign in.";
        }
        setAuthMessage(em, "error");
        return;
      }
      if (authMode === "signup" && !res.data.session) {
        // Switch to sign-in first (it clears the message), THEN show the notice,
        // so the "check your email" prompt isn't wiped out.
        setAuthMode("signin");
        setAuthMessage(
          "✅ Account created! We've sent a confirmation link to " + email +
          ". Check your inbox (and spam) to verify your email, then sign in here.",
          "success"
        );
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
    var addCreditsBtn = $("add-credits");
    if (session) {
      userEmail.textContent = session.user.email;
      userEmail.classList.remove("hidden");
      signOutBtn.classList.remove("hidden");
      signInBtn.classList.add("hidden");
      if (addCreditsBtn) addCreditsBtn.classList.remove("hidden"); // Bedrock credits
      refreshCredits();
      handleTopupReturn();
      checkAdmin();
    } else {
      userEmail.textContent = "";
      userEmail.classList.add("hidden");
      signOutBtn.classList.add("hidden");
      signInBtn.classList.remove("hidden");
      if (addCreditsBtn) addCreditsBtn.classList.add("hidden");
      var al = document.getElementById("admin-link"); if (al) al.classList.add("hidden");
      refreshCredits(); // guests: show the per-device free-token badge
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
    loadConversations(true); // initial restore of last chat
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

  // Snackbar-style undo delete: clicking the trash removes the project from the list
  // right away and shows a 6-second "click to undo" toast at the bottom-left. The real
  // DB delete is DEFERRED until the toast expires, so undo just cancels it — no blocking
  // confirm() dialog, no data lost if it was a misclick.
  var pendingProjectDelete = null;        // { id, project, index, timer }
  var deleteToastEl = null;

  function restoreProjectToList(project, index) {
    if (!project || projects.some(function (p) { return p.id === project.id; })) return;
    var i = (index >= 0 && index <= projects.length) ? index : projects.length;
    projects.splice(i, 0, project);
    renderProjectList();
  }
  function hideDeleteToast() {
    if (deleteToastEl) { deleteToastEl.remove(); deleteToastEl = null; }
  }
  function commitPendingProjectDelete() {
    if (!pendingProjectDelete) return;
    var pd = pendingProjectDelete;
    pendingProjectDelete = null;
    if (pd.timer) clearTimeout(pd.timer);
    hideDeleteToast();
    dbDeleteProject(pd.id).then(function (res) {
      if (res && res.error) { // server refused → put it back so nothing is silently lost
        restoreProjectToList(pd.project, pd.index);
        alert("Could not delete project: " + res.error.message);
      }
    });
  }
  function undoPendingProjectDelete() {
    if (!pendingProjectDelete) return;
    var pd = pendingProjectDelete;
    pendingProjectDelete = null;
    if (pd.timer) clearTimeout(pd.timer);
    hideDeleteToast();
    restoreProjectToList(pd.project, pd.index);
    openProject(pd.id); // reopen it, restoring the previous view
  }
  function showDeleteToast(onUndo) {
    hideDeleteToast();
    var t = document.createElement("div");
    t.className = "undo-toast";
    t.setAttribute("role", "status");
    t.innerHTML = '<span class="undo-toast-msg">🗑 Deleting project…</span>' +
      '<span class="undo-toast-action">click to undo</span>';
    t.addEventListener("click", onUndo);
    document.body.appendChild(t);
    void t.offsetWidth;          // reflow so the fade-in transition runs
    t.classList.add("show");
    deleteToastEl = t;
  }

  deleteProjectBtn.addEventListener("click", function () {
    if (currentProjectId == null) return;
    // If another delete is still pending, commit it first so we don't lose track of it.
    if (pendingProjectDelete) commitPendingProjectDelete();
    var id = currentProjectId;
    var index = projects.findIndex(function (p) { return p.id === id; });
    var project = index >= 0 ? projects[index] : null;
    if (!project) return;
    // Optimistically remove from the list + clear the current view.
    projects = projects.filter(function (p) { return p.id !== id; });
    currentProjectId = null;
    currentFileId = null;
    files = [];
    filesSection.classList.add("hidden");
    closeEditorPanel();
    renderProjectList();
    // Defer the real delete 6s; the toast (click = undo) cancels it.
    pendingProjectDelete = { id: id, project: project, index: index, timer: null };
    pendingProjectDelete.timer = setTimeout(commitPendingProjectDelete, 6000);
    showDeleteToast(undoPendingProjectDelete);
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
    if (typeof updateTopButton === "function") updateTopButton(); // Top depends on the graph existing
    var topId = resolveTop();
    // Show the declared top file first, then the rest alphabetically.
    // module_map.json is derived metadata for the 🧩 Modules view — keep it out of the list.
    var ordered = files.filter(function (f) { return f.name !== "module_map.json"; }).sort(function (a, b) {
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
    removeBuildControls(); // a new prompt supersedes any stopped-build "Continue"

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
    // Keep the running context bounded: if the chat has grown very long, summarize
    // the earlier turns and continue in a fresh session (context preserved, not lost).
    try { await maybeSummarizeContext(provider, key, model); } catch (e) {}

    appendChatMsg("user", displayUserMsg, imgs);
    chatHistory.push({ role: "user", content: displayUserMsg, images: imgs });
    try { await saveConversation(); } catch (e) {}

    var bubble = appendChatMsg("assistant", "🤔 Thinking...");
    chatSend.disabled = true;

    // FOLLOW-UP ON AN EXISTING DESIGN → classify BEFORE the generic project router.
    // A short follow-up like "change it to divide by 3, not 5" doesn't look like a
    // build request to the router and would be wrongly bounced by the hardware topic
    // gate below; the existing project context makes the intent clear, so resolve it
    // here first. EDIT → apply in place (no approval popup, rebuild only affected
    // modules). NEW → open a fresh chat + project, then fall through to the full flow.
    // CHAT → answer as a question about the design (no rebuild, not blocked by the gate).
    if (currentProjectId != null && designSpecText() &&
        files.some(function (f) { return isVerilogName(f.name) && f.name !== "netlist.v"; })) {
      var exMods = files.filter(function (f) { return isVerilogName(f.name) && f.name !== "netlist.v"; });
      var intent = "EDIT"; // default: never silently discard their work
      if (!imgs.length) {
        try {
          var modList = exMods.map(function (f) { return f.name; }).join(", ");
          var sysEdit = "The user already has a Verilog project (modules: " + modList + ").\n" +
            "Current design spec:\n" + String(designSpecText()).slice(0, 1500) + "\n\n" +
            "Classify the user's new message:\n" +
            "- EDIT: asks to modify, fix, change, or extend THIS existing design.\n" +
            "- NEW: asks to build a DIFFERENT, unrelated hardware design from scratch.\n" +
            "- CHAT: a question, explanation, or comment that does NOT ask to change the design.\n" +
            "Reply with only one word: EDIT, NEW, or CHAT.";
          var eRes = await callLLM(provider, key, model, sysEdit, [{ role: "user", content: promptText }]);
          if (/^\s*new\b/i.test(eRes || "")) intent = "NEW";
          else if (/^\s*chat\b/i.test(eRes || "")) intent = "CHAT";
        } catch (e) { /* on failure, keep the safe default (EDIT) */ }
      }
      if (intent === "EDIT") {
        await runEditFlow(bubble, fullPrompt, provider, key, model);
        return;
      }
      if (intent === "CHAT") {
        try {
          var sysC = buildProjectContext();
          var replyC = await callLLM(provider, key, model, sysC, chatHistory);
          var dispC = stripFileBlocks(replyC);
          bubble.textContent = dispC;
          chatHistory.push({ role: "assistant", content: dispC });
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
      // NEW → open a fresh chat + deselect the current project, then fall through to
      // the full build flow (ensureProject creates a new project below).
      startNewProjectContext();
      appendChatMsg("user", displayUserMsg, imgs);
      chatHistory.push({ role: "user", content: displayUserMsg, images: imgs });
      bubble = appendChatMsg("assistant", "🆕 New project — writing a fresh spec…");
    }

    // Check if it's a project request
    var isProject = true;
    if (!imgs.length) {
        try {
            var sysRoute = "Does the user's prompt explicitly ask to build, write, design, or create a Verilog or hardware project? If it is just a conversational greeting, general question, or unrelated text, reply NO. Reply only YES or NO.";
            var routeRes = await callLLM(provider, key, model, sysRoute, [{role: "user", content: promptText}]);
            // Only drop to plain-chat when the answer clearly STARTS with "NO"
            // (avoids matching "NOT"/"KNOW" etc., and defaults an ambiguous or
            // malformed reply to the full build+verify flow instead of skipping it).
            if (/^\s*no\b/i.test(routeRes || "")) {
                isProject = false;
            }
        } catch(e) { }
    }

    if (!isProject) {
        // Hard scope guard for casual chat: redirect anything NOT about hardware,
        // so off-topic requests are blocked here just like in the Verifier flow —
        // regardless of how well the model obeys the system prompt. (Skipped when
        // images are attached, since those may be schematics/diagrams.)
        var onTopic = true;
        if (!imgs.length) {
            try {
                var sysTopic = "Is the user's message about DIGITAL HARDWARE, Verilog/SystemVerilog, RTL, FPGAs, digital logic, or electronics design — including a question or explanation about it? Reply NO for greetings, small talk, or anything unrelated to hardware. Reply only YES or NO.";
                var topicRes = await callLLM(provider, key, model, sysTopic, [{ role: "user", content: promptText }]);
                if (/^\s*no\b/i.test(topicRes || "")) onTopic = false;
            } catch (e) { /* on failure, don't block — default to answering */ }
        }
        if (!onTopic) {
            bubble.textContent = "🛠 I only help with digital hardware design in Verilog/SystemVerilog. Please describe a hardware/Verilog design — a module, FSM, datapath, memory, interface, or testbench — and I'll help.";
            chatHistory.push({ role: "assistant", content: bubble.textContent });
            chatSend.disabled = false;
            chatConversation.scrollTop = chatConversation.scrollHeight;
            try { await saveConversation(); } catch (e) {}
            return;
        }
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
    var buildPrompt = buildContextPreamble() + fullPrompt; // context-aware follow-ups
    try {
      var resp;
      var retries = 0;
      while (true) {
        try {
          resp = await fetch(base + "/flow/start", {
            method: "POST",
            credentials: "include",
            headers: Object.assign({ "Content-Type": "application/json", "X-Anon-Id": getAnonId() }, await authHeaders()),
            body: JSON.stringify({ prompt: buildPrompt, provider: provider, key: key, builderModel: model }),
          });
          break; // successfully connected!
        } catch (e) {
          bubble.textContent = "⚠ Couldn't reach backend. Retrying connection...";
          // Wait 2 seconds before trying again
          await new Promise(function(resolve) { setTimeout(resolve, 2000); });
        }
      }

      var data = await resp.json();
      if (typeof data.balance === "number") updateCreditsBadge(data.balance);
      if (data.error) {
        if (/credit/i.test(data.error)) onOutOfCredits();
        bubble.textContent = "⚠ " + data.error;
        bubble.classList.add("chat-error");
        return;
      }
      if (data.offTopic) {
        // Scope guard: not a hardware/Verilog request — redirect, don't build.
        bubble.textContent = "🛠 " + (data.redirect ||
          "This tool only designs digital hardware in Verilog. Please describe a hardware / Verilog design and I'll build it.");
        flowThreadId = null;
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

  var activeBuildThreadId = null; // the build currently running (for Stop)
  function genUUID() {
    try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
    return "b-" + Date.now() + "-" + Math.floor(Math.random() * 1e9);
  }
  // Save a module's code to the project as it's built, so a Stop preserves progress.
  async function saveBuiltFile(name, code) {
    if (currentProjectId == null || !name) return;
    var existing = files.find(function (f) { return f.name === name; });
    if (existing) {
      existing.code = code;
      try { await dbUpdateFile(existing.id, { name: name, code: code }); } catch (e) {}
    } else {
      try {
        var r = await dbCreateFile(currentProjectId, name, code);
        if (!r.error) { files.push(r.data); renderFileList(); }
      } catch (e) {}
    }
  }
  // ---- Stop / Continue controls ----
  function removeBuildControls() {
    var el = $("build-controls"); if (el && el.parentNode) el.parentNode.removeChild(el);
  }
  function showStopButton() {
    removeBuildControls();
    var wrap = document.createElement("div");
    wrap.id = "build-controls"; wrap.className = "chat-msg assistant build-controls";
    var btn = document.createElement("button");
    btn.className = "btn"; btn.textContent = "⏹ Stop build";
    btn.addEventListener("click", function () {
      btn.disabled = true; btn.textContent = "stopping…";
      stopActiveBuild();
    });
    wrap.appendChild(btn);
    chatConversation.appendChild(wrap);
    chatConversation.scrollTop = chatConversation.scrollHeight;
  }
  function showContinueButton() {
    removeBuildControls();
    var wrap = document.createElement("div");
    wrap.id = "build-controls"; wrap.className = "chat-msg assistant build-controls";
    var p = document.createElement("div");
    p.textContent = "⏸ Build stopped. Resume from where it left off:";
    var btn = document.createElement("button");
    btn.className = "btn"; btn.style.marginTop = "6px"; btn.textContent = "▶ Continue build";
    btn.addEventListener("click", function () { btn.disabled = true; removeBuildControls(); resumeBuild(); });
    wrap.appendChild(p); wrap.appendChild(btn);
    chatConversation.appendChild(wrap);
    chatConversation.scrollTop = chatConversation.scrollHeight;
  }
  function stopActiveBuild() {
    if (!activeBuildThreadId) return;
    var base = getBackendUrl();
    fetch(base + "/flow/stop", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId: activeBuildThreadId }),
    }).catch(function () {}); // the build stops between modules and returns its partial result
  }
  // Resume a stopped build: rebuild from the current project files (skip done modules).
  async function resumeBuild() {
    var base = getBackendUrl();
    if (!base) { consoleLog("⚠ Set a backend first.", "error"); return; }
    var provider = currentProvider();
    var key = getProviderKey(provider);
    if (!key) { renderChatView(); return; }
    var spec = lastFlowSpec || "";
    if (!spec) { var sf = files.find(function (f) { return /^spec\.md$/i.test(f.name); }); spec = (sf && sf.code) || ""; }
    if (!spec) { consoleLog("⚠ No spec to resume from — start a new build.", "error"); return; }
    var vfiles = files.filter(function (f) { return isVerilogName(f.name) && f.name !== "netlist.v"; })
      .map(function (f) { return { name: f.name, code: f.code || "" }; });
    var model = getProviderModel(provider);
    var tid = genUUID(); activeBuildThreadId = tid;
    var bubble = appendChatMsg("assistant", "▶ Resuming build…");
    showStopButton();
    try {
      var resp = await fetch(base + "/flow/continue", {
        method: "POST",
        credentials: "include",
        headers: Object.assign({ "Content-Type": "application/json", "X-Anon-Id": getAnonId() }, await authHeaders()),
        body: JSON.stringify({ threadId: tid, spec: spec, files: vfiles, provider: provider, key: key, builderModel: model, verifierModel: model }),
      });
      var data = await readFlowStream(resp);
      if (data && typeof data.balance === "number") updateCreditsBadge(data.balance);
      if (!data || data.error) {
        bubble.textContent = "⚠ " + ((data && data.error) || "resume failed");
        bubble.classList.add("chat-error");
        if (/credit/i.test((data && data.error) || "")) onOutOfCredits();
        return;
      }
      await finishFlowBuild(data);
    } catch (e) {
      bubble.textContent = "⚠ resume error: " + ((e && e.message) || e);
      bubble.classList.add("chat-error");
    } finally {
      activeBuildThreadId = null; removeBuildControls();
      refreshCredits();
    }
  }

  // Follow-up edit to an existing project: no approval popup. Sends the change request
  // + current spec + current files to /flow/continue with editRequest; the backend
  // updates the spec and rebuilds/re-testbenches ONLY the affected modules, keeping the
  // rest. Saves the returned (updated) spec back to spec.md via finishFlowBuild.
  async function runEditFlow(bubble, editText, provider, key, model) {
    var base = getBackendUrl();
    var spec = designSpecText();
    var vfiles = files.filter(function (f) { return isVerilogName(f.name) && f.name !== "netlist.v"; })
      .map(function (f) { return { name: f.name, code: f.code || "" }; });
    var tid = genUUID(); activeBuildThreadId = tid;
    bubble.textContent = "✏️ Applying your change — updating the spec and rebuilding only the affected modules…";
    showStopButton();
    try {
      var resp = await fetch(base + "/flow/continue", {
        method: "POST",
        credentials: "include",
        headers: Object.assign({ "Content-Type": "application/json", "X-Anon-Id": getAnonId() }, await authHeaders()),
        body: JSON.stringify({ threadId: tid, spec: spec, files: vfiles, editRequest: editText,
          provider: provider, key: key, builderModel: model, verifierModel: model }),
      });
      var data = await readFlowStream(resp);
      activeBuildThreadId = null; removeBuildControls();
      if (data && typeof data.balance === "number") updateCreditsBadge(data.balance);
      if (!data || data.error) {
        bubble.textContent = "⚠ " + ((data && data.error) || "edit failed");
        bubble.classList.add("chat-error");
        if (/credit/i.test((data && data.error) || "")) onOutOfCredits();
        return;
      }
      if (data.spec) lastFlowSpec = data.spec; // finishFlowBuild saves this to spec.md
      await finishFlowBuild(data);
      refreshCredits();
    } catch (e) {
      bubble.textContent = "⚠ edit error: " + ((e && e.message) || e);
      bubble.classList.add("chat-error");
    } finally {
      activeBuildThreadId = null; removeBuildControls(); chatSend.disabled = false;
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
      activeBuildThreadId = flowThreadId;
      showStopButton();
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
            credentials: "include",
            headers: Object.assign({ "Content-Type": "application/json", "X-Anon-Id": getAnonId() }, await authHeaders()),
            body: JSON.stringify({ threadId: flowThreadId, approved: approved, changes: changes || "", provider: currentProvider() }),
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
      activeBuildThreadId = null; removeBuildControls();
      if (data && typeof data.balance === "number") updateCreditsBadge(data.balance); // Bedrock spend
      if (!data || data.error) {
        var errText = "⚠ " + ((data && data.error) || "no response from backend");
        if (/credit/i.test((data && data.error) || "")) onOutOfCredits();
        if (bubble) { bubble.textContent = errText; bubble.classList.add("chat-error"); }
        else specModalText.textContent = errText;
        setSpecBusy(false);
        return;
      }
      if (!data.done) { showSpecModal(data.spec); return; } // revised spec → review again
      if (!approved) hideSpecModal(); // hide it if it was open during revise
      flowThreadId = null;
      await finishFlowBuild(data);
      refreshCredits();
    } catch (e) {
      activeBuildThreadId = null; removeBuildControls();
      var errText = "⚠ " + ((e && e.message) || e);
      if (bubble) { bubble.textContent = errText; bubble.classList.add("chat-error"); }
      else specModalText.textContent = errText;
      setSpecBusy(false);
    }
  }

  // Log a single build event live (used as the NDJSON stream arrives).
  function logBuildEvent(ev) {
    if (!ev) return;
    if (ev.type === "editPlan") {
      consoleLog((ev.changed && ev.changed.length)
        ? "✏️ edit: rebuilding only " + ev.changed.join(", ") + " (other modules kept)"
        : "✏️ edit: spec updated — no module changes needed", "info");
    } else if (ev.type === "plan") {
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
    } else if (ev.type === "coverageStart") {
      consoleLog("   • coverage: running Verilator…", "info");
    } else if (ev.type === "coverage") {
      if (ev.available === false) consoleLog("   • coverage: skipped (Verilator not installed on the backend)", "warn");
      else if (!ev.ran) consoleLog("   • coverage: couldn't run" + (ev.reason ? " — " + ev.reason : ""), "warn");
      else consoleLog("   • coverage: " + (ev.linePercent != null ? ev.linePercent + "% lines executed" : "measured") +
        (ev.hitLines != null ? " (" + ev.hitLines + "/" + ev.totalLines + ")" : ""), "ok");
    } else if (ev.type === "resetFix") {
      consoleLog("🔧 " + ev.module + ": reset auto-corrected in code (async → synchronous, no LLM call)", "ok");
    } else if (ev.type === "file") {
      saveBuiltFile(ev.name, ev.code); // persist each module as it's built (survives Stop)
    } else if (ev.type === "skipped") {
      consoleLog("⏭ " + ev.module + " — already built, skipping (resume)", "info");
    } else if (ev.type === "stopped") {
      consoleLog("⏹ build stopped by user" + (ev.module ? " (before " + ev.module + ")" : ""), "warn");
    } else if (ev.type === "refixPlan") {
      if (ev.modules && ev.modules.length) consoleLog("🔧 re-fix plan: rewriting " + ev.modules.join(", "), "info");
      else consoleLog("🔧 re-fix: the Verifier found no mismatched modules", "ok");
    } else if (ev.type === "conformance") {
      var confWhere = ev.phase === "final" ? " (final review)" : (ev.phase === "refix" ? " (re-fix)" : "");
      if (ev.ok === false) {
        consoleLog("⚠ " + ev.module + ": Verifier found a SPEC violation" + confWhere + " — sending back to the Builder to fix" +
          (ev.issues ? " (" + String(ev.issues).split("\n")[0].slice(0, 120) + ")" : ""), "warn");
      } else {
        consoleLog("✓ " + ev.module + ": conforms to the spec" + confWhere, "ok");
      }
    } else if (ev.type === "budgetWarn") {
      consoleLog("⚠ heads up: verification/correction has passed " + (ev.threshold || 20) +
        " LLM operations and is continuing — this project is complex or buggy enough to keep needing fixes. " +
        "It won't stop on its own; watch your API usage.", "warn");
    } else if (ev.type === "budgetDecision") {
      consoleLog("⚠ verification has used " + (ev.used || 20) + " LLM operations — choose how to proceed…", "warn");
      showBudgetDecision(ev.used, ev.allowRaise !== false);
    } else if (ev.type === "budgetDecided") {
      var msg = ev.choice === "buildOnly" ? "no more module tests — building the rest without verification"
        : ev.choice === "raiseCutoff" ? "raised the complexity cutoff to " + (ev.cutoff || 50) + " — fewer modules get functional testing"
        : "continuing to test all modules";
      consoleLog("→ " + msg, "info");
    } else if (ev.type === "summary") {
      consoleLog("📝 " + ev.module + ": described for the Verifier (ports, params, function, clock/reset)", "info");
    } else if (ev.type === "verifyStart") {
      consoleLog("🧪 " + ev.module + " — " + ev.tier + " tier checks:", "info");
    } else if (ev.type === "check") {
      if (ev.name === "lint") {
        if (ev.ok) consoleLog("   • lint: clean ✓", "ok");
        else consoleLog("   • lint: issues ✗" + (ev.reason ? " — " + ev.reason : ""), "error");
      } else if (ev.name === "synth") {
        if (ev.available === false) consoleLog("   • synthesis: skipped (yosys not installed) — sim-only scan still ran", "warn");
        else if (ev.synthesizable === true) consoleLog("   • synthesis: synthesizable ✓", "ok");
        else if (ev.synthesizable === false) consoleLog("   • synthesis: NOT synthesizable ✗" + (ev.reason ? " — " + ev.reason : ""), "error");
        else consoleLog("   • synthesis: inconclusive", "warn");
      } else if (ev.name === "smoke") {
        var slbl = ev.tier === "smoke" ? "smoke testbench" : "smoke baseline";
        if (ev.passed === true) consoleLog("   • " + slbl + ": runs clean ✓ (no undefined outputs)", "ok");
        else if (ev.passed === false) consoleLog("   • " + slbl + ": module produces X ✗" + (ev.reason ? " — " + ev.reason : ""), "error");
        else consoleLog("   • " + slbl + ": inconclusive (couldn't parse/run)", "warn");
      }
    } else if (ev.type === "floor") {
      // Live checks (lint/synth/smoke) and the functional localization (drill) were
      // already logged at event-time; the floor event carries only the final verdict.
      if (ev.tier === "smoke") {
        consoleLog("   → floor tier " + (ev.verification === "smoke" ? "PASSED ✓" : "FAILED ✗"),
          ev.verification === "smoke" ? "ok" : "error");
      } else {
        if (ev.funcTbPassed === true) consoleLog("   • functional testbench (oracle): PASSED ✓", "ok");
        else if (ev.funcTbPassed === false) consoleLog("   • functional testbench (oracle): FAILED ✗" + (ev.funcTbReason ? " — " + ev.funcTbReason : ""), "error");
        else consoleLog("   • functional testbench (oracle): inconclusive" + (ev.smokeSimPassed === true ? " (module runs clean, so the TEST was broken)" : " (couldn't compile/run)"), "warn");
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
    } else if (ev.type === "built") {
      if (ev.ok) consoleLog("✓ " + ev.module + " built & verified", "ok");
      else consoleLog("✗ " + ev.module + " FAILED after " + ev.attempts + " attempts: " +
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
    if (data.stopped) consoleLog("⏹ Build stopped — partial progress saved.", "warn");
    else consoleLog("✅ Spec approved — Builder finished.", "ok");
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
    // Persist the module map (tree + code + LLM testbench/oracle + summary) so the
    // 🧩 Modules view survives a reload. Hidden from the Files list.
    var modMap = (data.manifest || []).map(function (m) {
      return {
        name: m.name, purpose: m.purpose, dependsOn: m.dependsOn, tier: m.tier,
        verification: m.verification, complexity: m.complexity, summary: m.summary,
        funcTb: m.funcTb, smokeTb: m.smokeTb, code: m.code, coverage: m.coverage,
        funcTbPassed: m.funcTbPassed, smokeSimPassed: m.smokeSimPassed,
      };
    });
    if (modMap.length) edits.push({ name: "module_map.json", content: JSON.stringify(modMap) });
    Object.keys(filesObj).forEach(function (n) {
      edits.push({ name: /\.s?v$/i.test(n) ? n : n + ".v", content: filesObj[n] });
    });
    if (Object.keys(filesObj).length) {
      var applied = await applyFileEdits(edits);
      var msg1 = data.stopped
        ? "⏸ Build stopped — saved " + Object.keys(filesObj).length + " module(s) so far: " + applied.join(", ") + ". Click Continue to finish."
        : "🏗 Built " + Object.keys(filesObj).length + " module(s) and saved the spec. Files: " + applied.join(", ");
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
        if (reviewFailed(data.review)) offerRefix(); // FAILED → offer a one-click re-fix
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
    if (data.stopped) showContinueButton(); // let the user resume where it left off
    try { await saveConversation(); } catch (e) {}
  }

  // Does the Verifier's final review carry a FAILED verdict?
  function reviewFailed(text) {
    if (!text) return false;
    return /verdict[\s\S]{0,40}\bfail/i.test(text) || /\boverall[\s\S]{0,60}\bfail/i.test(text);
  }

  // Offer a one-click "rewrite the mismatched modules + re-verify" action.
  function offerRefix() {
    var wrap = document.createElement("div");
    wrap.className = "chat-msg assistant refix-offer";
    var p = document.createElement("div");
    p.textContent = "⚠ The review found spec mismatches. Send it back to the LLM to rewrite the mismatched modules and re-verify (complexity + functional testbench)?";
    var btn = document.createElement("button");
    btn.className = "btn"; btn.style.marginTop = "8px";
    btn.textContent = "🔧 Fix mismatches & re-verify";
    btn.addEventListener("click", function () { btn.disabled = true; doRefix(btn); });
    wrap.appendChild(p); wrap.appendChild(btn);
    chatConversation.appendChild(wrap);
    chatConversation.scrollTop = chatConversation.scrollHeight;
  }

  // Merge a /refix result back into the project (files, module map, dev view).
  async function applyRefixResult(data) {
    lastFlowData = lastFlowData || {};
    if (data.manifest) lastFlowData.manifest = data.manifest;
    if (data.summaries) lastFlowData.summaries = data.summaries;
    if (data.review) lastFlowData.review = data.review;
    var filesObj = data.files || {};
    var edits = Object.keys(filesObj).map(function (n) {
      return { name: /\.s?v$/i.test(n) ? n : n + ".v", content: filesObj[n] };
    });
    if (data.manifest && data.manifest.length) {
      var modMap = data.manifest.map(function (m) {
        return { name: m.name, purpose: m.purpose, dependsOn: m.dependsOn, tier: m.tier,
          verification: m.verification, complexity: m.complexity, summary: m.summary,
          funcTb: m.funcTb, smokeTb: m.smokeTb, code: m.code, coverage: m.coverage,
          funcTbPassed: m.funcTbPassed, smokeSimPassed: m.smokeSimPassed };
      });
      edits.push({ name: "module_map.json", content: JSON.stringify(modMap) });
    }
    if (edits.length && currentProjectId != null) await applyFileEdits(edits);
    updateDevButton();
    // If the module the editor is showing was rewritten, refresh it.
    if (currentFileId != null && editor) {
      var cur = files.find(function (f) { return f.id === currentFileId; });
      if (cur && filesObj[cur.name.replace(/\.s?v$/i, "")]) editor.setValue(cur.code || "", -1);
    }
  }

  // POST /refix: rewrite the review's mismatched modules and re-verify, streaming
  // progress to the console; then apply the updated files + fresh review.
  async function doRefix(btn) {
    var base = getBackendUrl();
    if (!base) { consoleLog("⚠ Set a backend first.", "error"); return; }
    var provider = currentProvider();
    var key = getProviderKey(provider);
    if (!key) { renderChatView(); return; }
    var manifest = (lastFlowData && lastFlowData.manifest) || [];
    if (!manifest.length) { consoleLog("⚠ No module data to re-fix — run Verify & Build first.", "error"); return; }
    var spec = lastFlowSpec || "";
    if (!spec) { var sf = files.find(function (f) { return /^spec\.md$/i.test(f.name); }); spec = (sf && sf.code) || ""; }
    var review = (lastFlowData && lastFlowData.review) || "";
    var model = getProviderModel(provider);
    var bubble = appendChatMsg("assistant", "🔧 Rewriting mismatched modules and re-verifying…");
    consoleLog("🔧 re-fix: sending the review back to rewrite mismatched modules…", "info");
    try {
      var resp = await fetch(base + "/refix", {
        method: "POST",
        credentials: "include",
        headers: Object.assign({ "Content-Type": "application/json", "X-Anon-Id": getAnonId() }, await authHeaders()),
        body: JSON.stringify({ spec: spec, manifest: manifest, review: review, provider: provider, key: key, builderModel: model, verifierModel: model }),
      });
      // A non-stream response (e.g. 404 because the backend isn't updated, or a
      // 500) won't parse as NDJSON — surface the real status instead of a blank fail.
      if (!resp.ok) {
        var body = await resp.text().catch(function () { return ""; });
        var hint = resp.status === 404
          ? " — the /refix endpoint isn't on the backend yet (run: git pull && pm2 restart server on EC2)."
          : "";
        bubble.textContent = "⚠ re-fix failed: HTTP " + resp.status + hint + (body ? " " + body.slice(0, 200) : "");
        bubble.classList.add("chat-error");
        if (resp.status === 402) onOutOfCredits();
        return;
      }
      var data = await readFlowStream(resp);
      if (data && typeof data.balance === "number") updateCreditsBadge(data.balance);
      if (!data || data.error) {
        bubble.textContent = "⚠ re-fix failed: " + ((data && data.error) || "the backend returned no result — it may be an older version without /refix (git pull && pm2 restart server).");
        bubble.classList.add("chat-error");
        if (/credit/i.test((data && data.error) || "")) onOutOfCredits();
        return;
      }
      await applyRefixResult(data);
      var summary = (data.fixed && data.fixed.length)
        ? "✅ Rewrote & re-verified: " + data.fixed.join(", ") + ". "
        : "No mismatched modules needed rewriting. ";
      bubble.textContent = summary + (data.passed ? "Verifier now: PASSED ✓" : "Verifier still reports issues.");
      chatHistory.push({ role: "assistant", content: bubble.textContent });
      if (data.review) {
        appendChatMsg("assistant", "🔎 Updated Verifier review:\n\n" + data.review);
        if (reviewFailed(data.review)) offerRefix(); // allow another pass
      }
      try { await saveConversation(); } catch (e) {}
    } catch (e) {
      bubble.textContent = "⚠ re-fix error: " + ((e && e.message) || e);
      bubble.classList.add("chat-error");
    } finally {
      refreshCredits();
    }
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

  // Stable per-browser id for the anonymous free tier. Lives in localStorage so it
  // survives closing/reopening the site, and works even where third-party cookies
  // are blocked (frontend and backend are different sites). Sent as X-Anon-Id.
  function getAnonId() {
    var k = "vc_anon_id";
    var v = localStorage.getItem(k);
    if (!v) {
      v = (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
        : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
            var r = (Math.random() * 16) | 0, val = c === "x" ? r : (r & 0x3) | 0x8;
            return val.toString(16);
          });
      localStorage.setItem(k, v);
    }
    return v;
  }

  // ---- Bedrock prepaid-credits plumbing -------------------------------------
  // The Bedrock provider has no BYOK key: the browser sends the signed-in user's
  // Supabase JWT, the backend calls Bedrock with its own AWS creds, and each call
  // is billed to the user's prepaid balance.
  function isSignedIn() { return !GUEST; }
  async function authHeaders() {
    try {
      var r = await sb.auth.getSession();
      var tok = r && r.data && r.data.session && r.data.session.access_token;
      return tok ? { Authorization: "Bearer " + tok } : {};
    } catch (e) { return {}; }
  }
  // Render the badge from the full status: monthly free allowance (+ prepaid
  // credits when the user has topped up). Pass null to hide (guests).
  function renderCreditsBadge(st) {
    var badge = $("credits-badge");
    if (!badge) return;
    if (!st) { badge.classList.add("hidden"); return; }
    var remaining = Number(st.tokens_remaining || 0) / 1e6; // micros -> dollars
    var cap = Number(st.monthly_token_cap || 0) / 1e6;
    badge.textContent = remaining <= 0 ? "Free credit used up" : "Free: $" + remaining.toFixed(2) + " left";
    badge.title = "Monthly free credit: $" + remaining.toFixed(2) + " of $" + cap.toFixed(2) +
      " left this month (resets on the 1st). Spend it on any Bedrock model.";
    badge.classList.remove("hidden");
    badge.classList.toggle("credits-low", remaining <= 0);
  }
  // Back-compat shim: any inline call just refreshes the full token status.
  function updateCreditsBadge(v) {
    if (v == null) { renderCreditsBadge(null); return; }
    refreshCredits();
  }
  // Reveal the topbar Admin link only if the signed-in account is an admin
  // (the backend returns 200 from /admin/keys/status for allowed emails).
  async function checkAdmin() {
    var link = document.getElementById("admin-link");
    if (!link) return;
    try {
      var headers = await authHeaders();
      if (!headers.Authorization) { link.classList.add("hidden"); return; }
      var r = await fetch(getBackendUrl() + "/admin/keys/status", { headers: headers });
      link.classList.toggle("hidden", !r.ok);
    } catch (e) { link.classList.add("hidden"); }
  }

  async function refreshCredits() {
    if (!isSignedIn()) { return refreshGuestCredits(); }
    try {
      var headers = await authHeaders();
      if (!headers.Authorization) return;
      var r = await fetch(getBackendUrl() + "/billing/account", { headers: headers });
      var d = await r.json();
      if (r.ok) renderCreditsBadgeSiteAware(d);
    } catch (e) { /* leave badge as-is */ }
  }
  // Guests: show the anonymous per-device free-token allowance (cookie-tracked).
  async function refreshGuestCredits() {
    try {
      var r = await fetch(getBackendUrl() + "/billing/anon-account", { credentials: "include", headers: { "X-Anon-Id": getAnonId() } });
      var d = await r.json();
      if (r.ok && d && d.enabled) renderCreditsBadgeSiteAware(d); else renderCreditsBadge(null);
    } catch (e) { renderCreditsBadge(null); }
  }
  // Render the token badge, but if the SITEWIDE monthly pool is spent AND this
  // user hasn't started this month, show a "back next month" notice instead.
  function renderCreditsBadgeSiteAware(st) {
    if (st && st.siteOpen === false && Number(st.tokens_used || 0) <= 0) {
      var badge = $("credits-badge");
      if (!badge) return;
      badge.textContent = "Free tier full — back next month";
      badge.title = "This month's sitewide free allowance is used up. It refreshes on the 1st \u2014 or connect your own API key (\ud83d\udd11) to keep going now.";
      badge.classList.remove("hidden");
      badge.classList.add("credits-low");
      return;
    }
    renderCreditsBadge(st);
  }
  async function startTopup() {
    if (!isSignedIn()) { alert("Sign in first to buy credits."); return; }
    try {
      var headers = Object.assign({ "Content-Type": "application/json" }, await authHeaders());
      var r = await fetch(getBackendUrl() + "/billing/checkout", { method: "POST", headers: headers, body: "{}" });
      var d = await r.json();
      if (d.url) { window.location.href = d.url; return; }
      alert("Couldn't start checkout: " + (d.error || r.status));
    } catch (e) { alert("Couldn't start checkout: " + ((e && e.message) || e)); }
  }
  // Called when a Bedrock call returns 402. Nudge the user to top up.
  function onOutOfCredits() {
    refreshCredits();
    if (!isSignedIn()) {
      alert("You've used the free credit on this device this month. Create a free account for a monthly allowance \u2014 or connect your own API key (\ud83d\udd11) to keep going now.");
    } else {
      alert("You've used your free monthly credit. It resets on the 1st \u2014 or connect your own API key (\ud83d\udd11) to keep going now.");
    }
  }
  // After returning from Stripe Checkout (?topup=success), refresh the balance.
  function handleTopupReturn() {
    var q = window.location.search || "";
    if (q.indexOf("topup=success") >= 0) {
      // Webhook applies the credit; poll a couple times in case it's a beat behind.
      setTimeout(refreshCredits, 1500);
      setTimeout(refreshCredits, 5000);
    }
    if (q.indexOf("topup=") >= 0 && window.history && window.history.replaceState) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }


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
    bedrock: {
      model: "us.meta.llama3-3-70b-instruct-v1:0",
      account: true, // no BYOK key — uses free credit (guest) or the account's credit
      hint: "No API key needed — free credit to start (no account required). Runs open models on Amazon Bedrock; sign in for a larger monthly allowance.",
      models: [
        "us.meta.llama3-3-70b-instruct-v1:0",
        "us.meta.llama4-maverick-17b-instruct-v1:0",
        "us.meta.llama4-scout-17b-instruct-v1:0",
        "us.deepseek.r1-v1:0",
        "us.amazon.nova-pro-v1:0",
        "us.mistral.pixtral-large-2502-v1:0",
        "us.amazon.nova-lite-v1:0",
        "us.amazon.nova-micro-v1:0",
        "us.meta.llama3-1-8b-instruct-v1:0",
      ],
    },
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
  // API keys live in sessionStorage, so they're cleared when the browser/tab is
  // CLOSED (but survive a reload). One-time migration moves any old localStorage
  // copy over, then deletes it so keys never persist across sessions again.
  (function migrateKeysToSession() {
    try {
      var old = localStorage.getItem("llm_connections");
      if (old && !sessionStorage.getItem("llm_connections")) sessionStorage.setItem("llm_connections", old);
      var oldActive = localStorage.getItem("llm_active_connection_id");
      if (oldActive && !sessionStorage.getItem("llm_active_connection_id")) sessionStorage.setItem("llm_active_connection_id", oldActive);
      localStorage.removeItem("llm_connections");
      localStorage.removeItem("llm_active_connection_id");
    } catch (e) {}
  })();
  function getConnections() {
    try { return JSON.parse(sessionStorage.getItem("llm_connections")) || []; }
    catch(e) { return []; }
  }
  function saveConnections(conns) { sessionStorage.setItem("llm_connections", JSON.stringify(conns)); }
  function getActiveConnectionId() { return sessionStorage.getItem("llm_active_connection_id"); }
  function setActiveConnectionId(id) { 
    if (id) sessionStorage.setItem("llm_active_connection_id", id);
    else sessionStorage.removeItem("llm_active_connection_id");
  }

  function currentProvider() { return localStorage.getItem("llm_provider") || "bedrock"; }
  
  function getProviderKey(p) {
    // Bedrock has no BYOK key. Return a non-secret sentinel so the existing
    // `if (!key)` gates pass for everyone; the backend identifies the caller by
    // JWT (signed-in) or the anon cookie (guest) and uses its own AWS creds.
    if (p === "bedrock") return "account";
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
    sessionStorage.removeItem("llm_connections");
    setActiveConnectionId(null);
  }

  // One-time migration from the old single-key storage to multiple connections.
  (function migrateKeys() {
    var conns = getConnections();
    var modified = false;
    
    // Check old single key
    var oldKey = localStorage.getItem("llm_api_key");
    var p = localStorage.getItem("llm_provider") || "bedrock";
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
    // Bedrock: no API key field — it uses the signed-in account's prepaid credits.
    if (info.account) {
      chatKeyInput.classList.add("hidden");
      chatSetupHint.textContent = isSignedIn()
        ? "✓ Signed in — Bedrock uses your monthly free tokens (then prepaid credits). Just click Connect."
        : "No account needed — click Connect to use Amazon Bedrock with free tokens on this device. Sign in for a larger monthly allowance.";
      chatKeySave.textContent = "Connect";
      renderSavedKeysList();
      return;
    }
    chatKeyInput.classList.remove("hidden");
    chatKeySave.textContent = "Save & connect";
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
    // History + New stay available even with no key so you can view past chats
    // (and start a fresh one) — you just can't SEND until a key is connected.
    chatNew.classList.remove("hidden");
    chatHistoryBtn.classList.remove("hidden");
  }

  function showKeySetup() {
    chatProvider.value = localStorage.getItem("llm_provider") || "bedrock";
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

  // Friendly display names for Bedrock model IDs (raw ids are ugly).
  var MODEL_LABELS = {
    "us.meta.llama3-3-70b-instruct-v1:0": "Llama 3.3 70B",
    "us.meta.llama4-maverick-17b-instruct-v1:0": "Llama 4 Maverick",
    "us.meta.llama4-scout-17b-instruct-v1:0": "Llama 4 Scout",
    "us.meta.llama3-1-8b-instruct-v1:0": "Llama 3.1 8B",
    "us.deepseek.r1-v1:0": "DeepSeek-R1",
    "us.amazon.nova-pro-v1:0": "Amazon Nova Pro",
    "us.amazon.nova-lite-v1:0": "Amazon Nova Lite",
    "us.amazon.nova-micro-v1:0": "Amazon Nova Micro",
    "us.mistral.pixtral-large-2502-v1:0": "Mistral Pixtral Large"
  };
  // Fill the model dropdown with popular models for the chosen provider.
  function populateModelList(provider) {
    var models = (PROVIDER_INFO[provider] || PROVIDER_INFO.openrouter).models || [];
    chatModelList.innerHTML = "";
    models.forEach(function (m) {
      var opt = document.createElement("option");
      opt.value = m;
      if (MODEL_LABELS[m]) opt.label = MODEL_LABELS[m];
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

  async function loadConversations(autoOpen) {
    var res = await dbListConversations();
    conversations = res.data || [];
    renderHistoryList();
    // Only the initial sign-in load restores the last chat. Opening the history
    // list (☰) must NOT auto-open, or it boots the user straight into a chat.
    if (autoOpen && chatHistory.length === 0 && conversations.length > 0 && currentConversationId == null) {
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

  // Start a brand-new project context: deselect the current project (so the next
  // build creates a fresh one) and open a new chat. Used when the AI detects the
  // prompt asks for a different/new design rather than an edit of the current one.
  function startNewProjectContext() {
    currentProjectId = null;
    currentFileId = null;
    files = [];
    filesSection.classList.add("hidden");
    closeEditorPanel();
    renderProjectList();
    newChat();
  }

  // Rough token estimate = chars / 4. When the conversation exceeds the limit,
  // summarize the whole transcript and START A NEW SESSION seeded with that
  // summary — so the model keeps the thread without an ever-growing (costly or
  // overflowing) history. Signed-in users' prior chat stays saved in History.
  var CONTEXT_CHAR_LIMIT = 32000; // ~8k tokens
  async function maybeSummarizeContext(provider, key, model) {
    var total = 0;
    chatHistory.forEach(function (m) { total += (m && m.content ? String(m.content).length : 0); });
    if (total < CONTEXT_CHAR_LIMIT || chatHistory.length < 4) return;

    var transcript = chatHistory.map(function (m) {
      return (m.role === "user" ? "User: " : "Assistant: ") + (m.content || "");
    }).join("\n");
    var sys = "You are compacting a Verilog/hardware design chat so it can continue in a new session. " +
      "Summarize the conversation concisely but PRESERVE all: module names, ports, bit-widths, clock/reset " +
      "style, design decisions, constraints, file names, and any open questions or next steps. Output only the summary.";
    var summary;
    try { summary = await callLLM(provider, key, model, sys, [{ role: "user", content: transcript }]); }
    catch (e) { return; } // if summarization fails, just continue with the full history
    if (!summary) return;

    // Persist the current (long) session before starting the new one.
    try { await saveConversation(); } catch (e) {}

    // Fresh session seeded with the summary (kept as context for later turns).
    chatHistory = [{ role: "assistant", content: "📝 Context summary (carried over from a longer chat):\n\n" + summary }];
    currentConversationId = null;
    localStorage.removeItem("last_conversation_id");
    chatConversation.innerHTML = "";
    renderConversation();
    appendChatMsg("assistant", isSignedIn()
      ? "🧵 This chat got long, so I summarized it and started a fresh session to keep context tight. Your previous chat is saved in History."
      : "🧵 This chat got long, so I summarized the earlier messages to keep context tight.");
    try { await saveConversation(); } catch (e) {}
  }

  // Build a compact context preamble for the AGENTIC BUILD flow so follow-up
  // requests ("add a reset to that", "make it 16-bit") are context-aware. Uses the
  // carried-over summary (if any) + recent user requests. Excludes the current
  // message (still the last item in chatHistory) and system notices. Bounded.
  function buildContextPreamble() {
    var prior = chatHistory.slice(0, -1); // everything before the current request
    if (!prior.length) return "";
    var parts = [];
    prior.forEach(function (m) {
      if (m.content && /^📝 Context summary/.test(m.content)) parts.push(m.content);
    });
    var users = prior.filter(function (m) {
      return m.role === "user" && m.content && !/^📝/.test(m.content);
    });
    users.slice(-5).forEach(function (m) { parts.push("Earlier request: " + m.content); });
    var ctx = parts.join("\n\n").trim();
    if (!ctx) return "";
    if (ctx.length > 6000) ctx = ctx.slice(-6000);
    return "=== Conversation context (reference only; the current project files reflect this) ===\n" +
           ctx + "\n\n=== Current request ===\n";
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
    // Bedrock has no key: "connecting" just means selecting it while signed in.
    if (provider === "bedrock") {
      // No sign-in required: guests get a per-device free token allowance
      // (cookie-tracked); signed-in users get their monthly allowance/credits.
      setActiveConnectionId(null); // Bedrock uses no key — clear any active API key
      localStorage.setItem("llm_provider", "bedrock");
      setProviderModel("bedrock", getProviderModel("bedrock") || PROVIDER_INFO.bedrock.model);
      renderChatView();
      refreshCredits();
      return;
    }
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

      // Make the connected key the ONE active connection (deactivating all others).
      if (typed) {
        addConnection(provider, typed); // new key -> created + set active
      } else {
        var existing = getConnections().filter(function (c) { return c.provider === provider; });
        if (existing.length) setActiveConnectionId(existing[0].id); // existing key -> activate it
      }
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
    if (typeof m !== "string") m = JSON.stringify(m);
    // OpenRouter says "Missing Authentication header" even when a key IS sent but
    // is invalid/expired — translate it into something the user can act on.
    if (resp.status === 401 && /missing authentication header|no (cookie )?auth credentials/i.test(m)) {
      m = "the API key was rejected (invalid, expired, or mis-pasted). Get a fresh key at openrouter.ai/keys, or switch providers.";
    }
    var err = new Error(m);
    err.status = resp.status;
    return err;
  }

  // Call the right endpoint for the chosen provider; return the reply text.
  // `system` carries the project files + edit instructions (handled per provider).
  async function callLLM(provider, key, model, system, history) {
    if (provider === "bedrock") {
      // Server-side call via the backend: browser sends its JWT, backend uses its
      // AWS creds and bills the user's prepaid credits.
      var bhead = await authHeaders(); // {} for guests — the anon cookie identifies them
      var bmsgs = history.map(function (m) {
        return { role: m.role, content: m.content || "", images: m.images || [] };
      });
      var br = await fetch(getBackendUrl() + "/bedrock/chat", {
        method: "POST",
        credentials: "include",
        headers: Object.assign({ "Content-Type": "application/json", "X-Anon-Id": getAnonId() }, bhead),
        body: JSON.stringify({ model: model, system: system, messages: bmsgs }),
      });
      var bd = await br.json();
      if (br.status === 402) {
        var msg402 = (bd && bd.error) || "Out of free Bedrock tokens.";
        if (bd && bd.code === "site_closed") { refreshCredits(); alert(msg402); }
        else onOutOfCredits();
        throw new Error(msg402);
      }
      if (!br.ok || bd.error) throw new Error(bd.error || ("Bedrock error " + br.status));
      refreshCredits(); // updates the user OR guest token badge
      return bd.reply || "";
    }
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

  // name -> functionality summary the Builder wrote (from this session's build, else
  // the persisted module_map.json). Gives the model WHAT a module does, not just ports.
  function getModuleSummaries() {
    var src = (lastFlowData && lastFlowData.manifest) || null;
    if (!src) {
      var mf = files.find(function (x) { return x.name === "module_map.json"; });
      if (mf) { try { src = JSON.parse(mf.code || "[]"); } catch (e) { src = null; } }
    }
    var out = {};
    (src || []).forEach(function (m) { if (m && m.name && m.summary) out[m.name] = m.summary; });
    return out;
  }
  function moduleNamesIn(code) {
    var names = [], re = /\bmodule\s+(\w+)/g, m;
    while ((m = re.exec(code || ""))) names.push(m[1]);
    return names;
  }
  // A compact "what it does" line (or two) from a module summary.
  function summaryDescription(sum) {
    if (!sum) return "";
    var bits = [];
    if (sum.intendedFunction) bits.push("Function: " + sum.intendedFunction);
    var cr = sum.clockReset;
    if (cr && (cr.clockTrigger || cr.resetType)) {
      var reset = cr.resetType ? (cr.resetType + " reset" + (cr.resetTrigger ? " (" + cr.resetTrigger + ")" : "")) : "";
      bits.push("Clock/reset: " + [cr.clockTrigger, reset].filter(Boolean).join(", "));
    }
    return bits.join("; ");
  }
  // The functionality description(s) for the module(s) a file defines, as comment lines.
  function fileFunctionality(f, summaries) {
    var descs = [];
    moduleNamesIn(f.code).forEach(function (n) {
      var d = summaryDescription(summaries[n]);
      if (d) descs.push("// " + (moduleNamesIn(f.code).length > 1 ? n + " — " : "") + d);
    });
    return descs.join("\n");
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
    var moduleSummaries = getModuleSummaries(); // functionality descriptions from the build
    var lines = [
      "You are an AI assistant embedded in a Verilog IDE. You can read and edit the files of the user's currently selected project.",
      "SCOPE: You ONLY help with DIGITAL HARDWARE design in Verilog/SystemVerilog (RTL modules, FSMs, datapaths, arithmetic, memories, interfaces, testbenches, synthesis). If the user asks you to build or write anything that is NOT digital hardware — software apps, web/mobile code, scripts, essays, general questions, math homework, images, etc. — do NOT build it and do NOT create/edit any non-hardware files. Politely decline in one or two sentences and redirect them to describe a hardware / Verilog design instead.",
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
          lines.push("--- " + f.name + " (interface + function — unchanged) ---");
          lines.push(extractInterface(f.code));
          var fn = fileFunctionality(f, moduleSummaries);
          if (fn) lines.push(fn);
          indexed++;
        } else {
          lines.push("--- " + f.name + " (unchanged, " + (f.code || "").length + " chars, body omitted) ---");
          indexed++;
        }
      });
      if (indexed) {
        lines.push("");
        lines.push("NOTE: Files marked '(interface + function)'/'(body omitted)' are UNCHANGED — you are shown their interface (ports) and a one-line description of what each module does, but not the full body, to save space. If you need to READ or REWRITE the full body of such a module before you can proceed, reply with a SINGLE line exactly: 'NEED: <filename>[, <filename>...]' and nothing else; the full files will be provided and you can continue. NEVER rewrite a module from its interface/description alone — always NEED its full body first, then output the full ```file:<name>``` block.");
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
  if (chatHistoryNew) chatHistoryNew.addEventListener("click", newChat);
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
        if (data.truncated) {
          var kb = Math.round((data.fullBytes || out.length) / 1024);
          consoleLog("⚠ output cut off here — the simulation printed " + kb + " KB, more than the display limit. Reduce $display volume to see the rest.", "warn");
        }
      }
    } catch (e) {
      consoleLog("✗ simulation: couldn't reach the backend — " + ((e && e.message) || e), "error");
    } finally {
      updateRunSimButton(); // re-enable per current-file state
    }
  });
  updateRunSimButton(); // initial state (disabled until a runnable file is open)

  // ---- Mid-build verification-budget decision (3 options) --------------------
  function sendBudgetDecision(choice) {
    var modal = $("budget-modal");
    if (modal) modal.classList.add("hidden");
    var base = getBackendUrl();
    if (!base || !flowThreadId) return;
    fetch(base + "/flow/decision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId: flowThreadId, choice: choice }),
    }).catch(function () {});
  }
  function showBudgetDecision(used, allowRaise) {
    var modal = $("budget-modal");
    if (!modal) { sendBudgetDecision("continue"); return; } // no UI → default
    var usedEl = $("budget-used");
    if (usedEl) usedEl.textContent = String(used || 20);
    // Only offer the reduce-LLM-call options not already taken (raise cutoff is
    // one-shot; once used it's hidden on later asks).
    var raiseBtn = $("budget-raise");
    if (raiseBtn) raiseBtn.classList.toggle("hidden", allowRaise === false);
    modal.classList.remove("hidden");
  }
  var budgetContinueBtn = $("budget-continue");
  var budgetBuildOnlyBtn = $("budget-buildonly");
  var budgetRaiseBtn = $("budget-raise");
  if (budgetContinueBtn) budgetContinueBtn.addEventListener("click", function () { sendBudgetDecision("continue"); });
  if (budgetBuildOnlyBtn) budgetBuildOnlyBtn.addEventListener("click", function () { sendBudgetDecision("buildOnly"); });
  if (budgetRaiseBtn) budgetRaiseBtn.addEventListener("click", function () { sendBudgetDecision("raiseCutoff"); });

  // ---- Modules browser: dependency tree + per-module code/testbench/oracle ----
  var modulesModal = $("modules-modal");
  var modulesTree = $("modules-tree");
  var modulesDetail = $("modules-detail");
  var openModulesBtn = $("open-modules");
  var modulesCloseBtn = $("modules-close");
  var modCodeAce = null;   // the editable Ace instance in the Modules "Verilog code" tab
  var modCodeFlush = null; // flushes its pending file save (call before teardown)

  function moduleRoots(manifest) {
    var depended = {};
    manifest.forEach(function (x) { (x.dependsOn || []).forEach(function (d) { depended[d] = true; }); });
    return manifest.filter(function (x) { return !depended[x.name]; });
  }
  // Build a module map by SCANNING the project's Verilog files (no build needed):
  // parse each `module … endmodule`, and dependsOn = the modules it instantiates.
  // Code is the module's own text; testbench/oracle/summary come only from a build.
  function scanModulesFromFiles() {
    var strip = function (s) { return String(s || "").replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, ""); };
    var mods = [], allNames = [];
    files.filter(function (f) { return isVerilogName(f.name); }).forEach(function (f) {
      var code = f.code || "";
      var re = /\bmodule\s+(\w+)\b[\s\S]*?\bendmodule\b/g, m;
      while ((m = re.exec(code))) {
        mods.push({ name: m[1], text: m[0], stripped: strip(m[0]), file: f.name });
        if (allNames.indexOf(m[1]) < 0) allNames.push(m[1]);
      }
    });
    return mods.map(function (mod) {
      var deps = [];
      allNames.forEach(function (n) {
        if (n === mod.name) return;
        var rx = new RegExp("\\b" + n + "\\b\\s*(?:#\\s*\\([^)]*(?:\\([^)]*\\)[^)]*)*\\))?\\s*\\w+\\s*\\(");
        if (rx.test(mod.stripped) && deps.indexOf(n) < 0) deps.push(n);
      });
      return { name: mod.name, purpose: "in " + mod.file, dependsOn: deps, code: mod.text, funcTb: "", smokeTb: "", summary: null, fromScan: true };
    });
  }
  // Staleness: has the module's RTL changed since its testbench/oracle was written?
  function normalizeVerilog(s) {
    // Strip comments and ALL whitespace so pure reformatting/comment edits don't
    // read as a change — only real code edits differ.
    return String(s || "").replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, "");
  }
  function extractModuleText(code, name) {
    var re = new RegExp("\\bmodule\\s+" + String(name).replace(/[^\w]/g, "") + "\\b[\\s\\S]*?\\bendmodule\\b");
    var m = re.exec(String(code || ""));
    return m ? m[0] : null;
  }
  // The whole-design spec the Verifier wrote (a saved spec.md, else this session's).
  function designSpecText() {
    var sf = files.find(function (f) { return /^spec\.md$/i.test(f.name); });
    return (sf && sf.code) || lastFlowSpec || "";
  }
  // Pull just THIS module's portion out of the design spec, if the spec is broken
  // up per module (a heading naming it, or a list/definition line naming it).
  // Returns "" when there's no spec or no section for this module.
  function moduleSpecSection(name) {
    var spec = designSpecText();
    if (!spec || !name) return "";
    var esc = String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    var nameRe = new RegExp("\\b" + esc + "\\b");
    var lines = spec.split("\n");
    // 1) A heading whose text names the module → capture down to the next
    //    heading at the same or higher level.
    for (var i = 0; i < lines.length; i++) {
      var hm = /^(#{1,6})\s+(.*)$/.exec(lines[i]);
      if (hm && nameRe.test(hm[2])) {
        var level = hm[1].length;
        var out = [lines[i]];
        for (var j = i + 1; j < lines.length; j++) {
          var nh = /^(#{1,6})\s+/.exec(lines[j]);
          if (nh && nh[1].length <= level) break;
          out.push(lines[j]);
        }
        return out.join("\n").trim();
      }
    }
    // 2) A list / definition line naming the module → that line plus any lines
    //    indented under it (its ports/behavior bullets).
    for (var k = 0; k < lines.length; k++) {
      var lm = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/.exec(lines[k]);
      if (lm && nameRe.test(lm[2])) {
        var baseIndent = lm[1].length;
        var block = [lines[k]];
        for (var n = k + 1; n < lines.length; n++) {
          if (/^\s*$/.test(lines[n])) break;
          var ind = (lines[n].match(/^\s*/) || [""])[0].length;
          if (ind > baseIndent) { block.push(lines[n]); continue; }
          break;
        }
        return block.join("\n").trim();
      }
    }
    return "";
  }
  // The project file that actually DEFINES this module (its own name.v, else the
  // first Verilog file whose text contains `module <name>`). Returns null if none.
  function fileForModule(name) {
    var f = files.find(function (x) { return x.name === name + ".v" || x.name === name + ".sv"; });
    if (f) return f;
    var re = new RegExp("\\bmodule\\s+" + String(name).replace(/[^\w]/g, "") + "\\b");
    return files.filter(function (x) { return isVerilogName(x.name); })
      .find(function (x) { return re.test(x.code || ""); }) || null;
  }
  function currentModuleCode(name) {
    var f = fileForModule(name);
    return f ? (f.code || "") : null;
  }
  // Format a stored Verilator coverage result for the Modules "Coverage" tab.
  function formatCoverage(cov) {
    if (!cov) return "(no coverage)";
    if (cov.available === false)
      return "⚠ Coverage unavailable — Verilator is not installed on the backend.\nInstall it on the server (e.g. apt/brew install verilator) to enable per-module line coverage.";
    if (!cov.ran)
      return "⚠ Coverage couldn't run for this module:\n" + (cov.reason || "unknown") +
        (cov.output ? "\n\n" + cov.output : "");
    var head = "Line coverage: " + (cov.linePercent != null ? cov.linePercent + "%" : "n/a") +
      (cov.hitLines != null ? "   (" + cov.hitLines + "/" + cov.totalLines + " instrumented lines executed at least once)" : "");
    var strict = cov.percent != null ? "\nLines fully covered (all branch/points hit): " + cov.percent + "%" : "";
    var body = cov.annotated
      ? "\n\n--- annotated source (leading count = times executed; %000000 = never hit) ---\n" + cov.annotated
      : (cov.summary ? "\n\n" + cov.summary : "");
    return head + strict + body;
  }
  function isTestbenchStale(m) {
    if (!m || m.fromScan) return false;             // scanned modules have no testbench
    if (!m.funcTb && !m.smokeTb) return false;       // nothing to be stale
    if (m.code == null) return false;                // no snapshot to compare against
    var cur = currentModuleCode(m.name);
    if (cur == null) return false;                   // current code not found — can't judge
    var curT = extractModuleText(cur, m.name) || cur;
    var oldT = extractModuleText(m.code, m.name) || m.code;
    return normalizeVerilog(curT) !== normalizeVerilog(oldT);
  }
  function moduleNode(m, byName, ancestors) {
    var li = document.createElement("li");
    li.className = "mod-node";
    var row = document.createElement("div");
    row.className = "mod-row";
    var kids = (m.dependsOn || []).filter(function (d) { return byName[d]; });
    var exp = document.createElement("span");
    exp.className = "mod-exp";
    exp.textContent = kids.length ? "▸" : "·"; // the "+" that reveals child modules
    row.appendChild(exp);
    var name = document.createElement("span");
    name.className = "mod-name";
    name.textContent = m.name;
    row.appendChild(name);
    if (m.verification) { // only from a build; scanned modules have no status
      var badge = document.createElement("span");
      badge.className = "mod-badge mod-" + m.verification;
      badge.textContent = m.verification;
      row.appendChild(badge);
    }
    if (isTestbenchStale(m)) {
      var stale = document.createElement("span");
      stale.className = "mod-badge mod-stale";
      stale.textContent = "⚠ out of date";
      stale.title = "This module's RTL has changed since its testbench/oracle was written";
      row.appendChild(stale);
    }
    li.appendChild(row);
    var childUl = document.createElement("ul");
    childUl.className = "mod-children hidden";
    li.appendChild(childUl);
    var expanded = false;
    function toggle() {
      if (!kids.length) return;
      expanded = !expanded;
      exp.textContent = expanded ? "▾" : "▸";
      childUl.classList.toggle("hidden", !expanded);
      if (expanded && !childUl.childElementCount) {
        kids.forEach(function (d) {
          if (ancestors[d]) return; // cycle guard
          var childAnc = Object.assign({}, ancestors); childAnc[m.name] = true;
          childUl.appendChild(moduleNode(byName[d], byName, childAnc));
        });
      }
    }
    exp.addEventListener("click", function (e) { e.stopPropagation(); toggle(); });
    row.addEventListener("click", function () { selectModule(m, row); });
    return li;
  }
  // Flush any pending code save and tear down the Modules code editor before its
  // DOM is wiped (switching modules, re-rendering, or closing the browser).
  function teardownModCode() {
    if (modCodeFlush) { try { modCodeFlush(); } catch (e) {} modCodeFlush = null; }
    if (modCodeAce) { try { modCodeAce.destroy(); } catch (e) {} modCodeAce = null; }
  }
  function selectModule(m, row) {
    teardownModCode();
    // highlight
    var prev = modulesTree.querySelector(".mod-row.active");
    if (prev) prev.classList.remove("active");
    if (row) row.classList.add("active");
    modulesDetail.innerHTML = "";
    var head = document.createElement("div");
    head.className = "mod-detail-head";
    var h = document.createElement("h4"); h.textContent = m.name; head.appendChild(h);
    var meta = document.createElement("div"); meta.className = "mod-detail-meta";
    meta.textContent = m.fromScan
      ? "scanned from project files" + (m.purpose ? " (" + m.purpose + ")" : "") + " — run Verify & Build for tier / verification / testbenches"
      : (m.tier ? m.tier + " tier · " : "") + (m.verification || "unverified") +
        (m.complexity != null ? " · complexity " + m.complexity + "/100" : "") +
        (m.purpose ? " · " + m.purpose : "");
    head.appendChild(meta);
    if (isTestbenchStale(m)) {
      var warn = document.createElement("div");
      warn.className = "mod-stale-warn";
      warn.textContent = "⚠ Out of date — this module's Verilog has changed since its testbench and oracle were written. They no longer match the current code; re-run Verify & Build to regenerate them.";
      head.appendChild(warn);
    }
    modulesDetail.appendChild(head);
    // The "Verilog code" tab is EDITABLE and backed by the real project file that
    // defines this module — edits here update Files (and vice versa). We read the
    // module's live slice out of that file so changes made in the main editor show
    // up here too. If we can't resolve a backing file (e.g. RTL not in the project),
    // the tab is read-only and shows the captured snapshot.
    var modFile = fileForModule(m.name);
    var liveSlice = modFile ? (extractModuleText(modFile.code || "", m.name) || (modFile.code || "")) : (m.code || "(RTL not captured)");
    var tabs = [
      { key: "code", label: "Verilog code" + (modFile ? "" : " (read-only)"), text: liveSlice, editable: !!modFile },
    ];
    var specSection = moduleSpecSection(m.name); // this module's slice of the design spec, if any
    if (specSection) tabs.push({ key: "spec", label: "Spec", text: specSection });
    tabs.push(
      { key: "func", label: "Testbench (LLM oracle)", text: m.funcTb || "(no functional oracle — this module is smoke-tier or wasn't functionally tested)" },
      { key: "smoke", label: "Smoke test", text: m.smokeTb || "(no smoke test)" },
      { key: "summary", label: "Summary", text: m.summary ? JSON.stringify(m.summary, null, 2) : "(no summary)" }
    );
    if (m.coverage) tabs.push({ key: "coverage", label: "Coverage", text: formatCoverage(m.coverage) });
    var tabBar = document.createElement("div"); tabBar.className = "mod-tabs";
    var pre = document.createElement("pre"); pre.className = "mod-code";                 // read-only tabs
    var edEl = document.createElement("div"); edEl.className = "mod-code mod-code-editor hidden"; // editable code tab
    modulesDetail.appendChild(tabBar);
    modulesDetail.appendChild(pre);
    modulesDetail.appendChild(edEl);

    // Editable code tab: Ace, two-way synced to the backing file.
    modCodeAce = null; modCodeFlush = null;
    var pendingSave = null;
    function doSave() { if (modFile) dbUpdateFile(modFile.id, { name: modFile.name, code: modFile.code }); }
    function scheduleSave() { if (pendingSave) clearTimeout(pendingSave); pendingSave = setTimeout(function () { pendingSave = null; doSave(); }, 500); }
    modCodeFlush = function () { if (pendingSave) { clearTimeout(pendingSave); pendingSave = null; doSave(); } };
    function ensureEditor() {
      if (modCodeAce || !modFile) return modCodeAce;
      var a = ace.edit(edEl);
      a.setTheme("ace/theme/monokai");
      a.session.setMode("ace/mode/verilog");
      a.setOptions({ fontSize: "13px", showPrintMargin: false, useWorker: false, tabSize: 4 });
      a.setValue(liveSlice, -1);
      a.on("change", function () {
        var newText = a.getValue();
        var full = modFile.code || "";
        var oldSlice = extractModuleText(full, m.name);
        var idx = oldSlice ? full.indexOf(oldSlice) : -1;
        // Splice the edited module back into its file when it's one of several;
        // if the module IS the whole file (or couldn't be isolated), replace all.
        var newFull = (oldSlice && idx >= 0 && oldSlice.trim() !== full.trim())
          ? full.slice(0, idx) + newText + full.slice(idx + oldSlice.length)
          : newText;
        if (newFull === modFile.code) return;
        modFile.code = newFull;                         // Files (in memory) — vice versa handled on next open
        if (currentFileId === modFile.id && editor) {   // reflect into the main editor if that file is open
          var p = editor.getCursorPosition();
          editor.session.setValue(newFull);
          editor.moveCursorToPosition(p);
        }
        scheduleSave();                                 // debounced DB write
      });
      modCodeAce = a;
      return a;
    }

    function show(t) {
      Array.prototype.forEach.call(tabBar.children, function (b) { b.classList.toggle("active", b.getAttribute("data-key") === t.key); });
      if (t.key === "code" && t.editable) {
        pre.classList.add("hidden");
        edEl.classList.remove("hidden");
        ensureEditor();
        modCodeAce.resize();
      } else {
        edEl.classList.add("hidden");
        pre.classList.remove("hidden");
        pre.textContent = t.text;
      }
    }
    tabs.forEach(function (t) {
      var b = document.createElement("button"); b.className = "btn btn-small mod-tab"; b.setAttribute("data-key", t.key); b.textContent = t.label;
      b.addEventListener("click", function () { show(t); });
      tabBar.appendChild(b);
    });
    show(tabs[0]);
  }
  function openModulesView() {
    if (!modulesModal) return;
    teardownModCode();
    syncCurrentFileFromEditor(); // so unsaved edits to the open module count for staleness
    modulesTree.innerHTML = "";
    // Source priority: this session's build → the persisted module_map.json (from
    // a prior build, survives reload) → a fresh scan of the project's .v files.
    var built = (lastFlowData && lastFlowData.manifest) || [];
    var manifest = built;
    if (!manifest.length) {
      var mapFile = files.find(function (f) { return f.name === "module_map.json"; });
      if (mapFile) { try { manifest = JSON.parse(mapFile.code || "[]") || []; } catch (e) { manifest = []; } }
    }
    var scanned = false;
    if (!manifest.length) { manifest = scanModulesFromFiles(); scanned = true; }
    if (!manifest.length) {
      var li = document.createElement("li");
      li.className = "empty-note";
      li.textContent = "No Verilog modules found. Add .v files or run Verify & Build.";
      modulesTree.appendChild(li);
    } else {
      var byName = {};
      manifest.forEach(function (x) { byName[x.name] = x; });
      moduleRoots(manifest).forEach(function (m) { modulesTree.appendChild(moduleNode(m, byName, {})); });
    }
    modulesDetail.innerHTML = "";
    var p = document.createElement("p"); p.className = "empty-note";
    p.textContent = scanned
      ? "Scanned from your project files. Select a module to see its Verilog; click ▸ to reveal child modules. (Run Verify & Build to also see testbenches, oracle, and verification status.)"
      : "Select a module to see its Verilog, testbench, and oracle. Click ▸ to reveal a module's child modules.";
    modulesDetail.appendChild(p);
    modulesModal.classList.remove("hidden");
  }
  if (openModulesBtn) openModulesBtn.addEventListener("click", openModulesView);
  if (modulesCloseBtn) modulesCloseBtn.addEventListener("click", function () { teardownModCode(); modulesModal.classList.add("hidden"); });
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
  // Find the TOP module from dependency_graph.md (no LLM): the module that nothing
  // else instantiates. Parses both the "## Modules" list and the mermaid edges.
  function parseTopFromDepGraph(md) {
    if (!md) return null;
    var deps = {}, allNames = {}, isDep = {};
    function addDep(a, b) {
      allNames[a] = true; allNames[b] = true;
      if (!deps[a]) deps[a] = [];
      if (deps[a].indexOf(b) < 0) deps[a].push(b);
      isDep[b] = true;
    }
    md.split("\n").forEach(function (line) {
      // Modules list:  - **name** ... → instantiates: a, b   |  depends on: a, b  |  leaf/none
      var mm = /^\s*[-*]\s*\*\*([A-Za-z_]\w*)\*\*/.exec(line);
      if (mm) {
        var name = mm[1]; allNames[name] = true; if (!deps[name]) deps[name] = [];
        var dm = /(?:instantiates|depends on)\s*:\s*(.+)$/i.exec(line);
        if (dm && !/\bnone\b/i.test(dm[1])) {
          dm[1].split(",").forEach(function (t) {
            var d = t.trim().replace(/[`*]/g, "").replace(/\s.*$/, "");
            if (/^[A-Za-z_]\w*$/.test(d)) addDep(name, d);
          });
        }
        return;
      }
      // Mermaid edge:  A --> B  (A instantiates B)
      var em = /^\s*([A-Za-z_]\w*)\s*--?>\s*([A-Za-z_]\w*)/.exec(line);
      if (em) addDep(em[1], em[2]);
    });
    var names = Object.keys(allNames);
    if (!names.length) return null;
    var roots = names.filter(function (n) { return !isDep[n]; });
    if (roots.length === 1) return roots[0];
    // multiple roots: a real top wires submodules — prefer the one WITH dependencies
    var withDeps = roots.filter(function (n) { return (deps[n] || []).length > 0; });
    if (withDeps.length === 1) return withDeps[0];
    return null; // ambiguous (0 roots = cycle, or multiple independent roots)
  }

  // Enable the Top button only when a dependency_graph.md is present.
  function depGraphFile() {
    return files.find(function (f) { return /^dependency_graph\.md$/i.test(f.name) && (f.code || "").trim(); });
  }
  function updateTopButton() {
    if (!detectTopBtn) return;
    var has = !!depGraphFile();
    detectTopBtn.disabled = !has;
    detectTopBtn.title = has
      ? "Find the top-level module from dependency_graph.md"
      : "No dependency_graph.md — run Verify & Build to generate one";
  }

  function detectTopFromGraph() {
    if (currentProjectId == null) { alert("Open a project first."); return; }
    var gf = depGraphFile();
    if (!gf) { alert("No dependency_graph.md found. Run Verify & Build to generate one."); return; }
    var topName = parseTopFromDepGraph(gf.code);
    if (!topName) {
      consoleLog("🔎 no single top module in dependency_graph.md (multiple independent roots?)", "warn");
      alert("Couldn't identify a single top module from the dependency graph.");
      return;
    }
    var f = fileForModule(topName);
    if (!f) {
      consoleLog("🔎 top module '" + topName + "' has no matching Verilog file", "warn");
      alert("Top module '" + topName + "' (from the graph) has no matching .v file.");
      return;
    }
    setDeclaredTop(f.id, "graph");
    renderFileList();
    consoleLog("🔎 top module: " + f.name + " (" + topName + ", from dependency_graph.md)", "ok");
  }

  detectTopBtn.addEventListener("click", detectTopFromGraph);

  signOutBtn.addEventListener("click", function () { sb.auth.signOut(); });
  (function () { var b = $("add-credits"); if (b) b.addEventListener("click", startTopup); })();
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
