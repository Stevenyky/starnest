/* ============================================================
   星巢无限 · STARNEST ∞
   应用层：路由、渲染、入职、工位、安全演练
   纯原生 JavaScript，无第三方依赖。
   ============================================================ */
(function () {
  "use strict";

  const D = window.STARNEST;
  const app = document.getElementById("app");
  const main = document.getElementById("main");
  if (!D || !app || !main) {
    return;
  }

  /* 隧道或弱网偶发样式请求中断时，重试一次，避免裸 HTML 页面。 */
  window.addEventListener(
    "load",
    function () {
      const link = document.querySelector('link[rel="stylesheet"]');
      if (link && link.sheet) return;
      const retry = document.createElement("link");
      retry.rel = "stylesheet";
      retry.href = "assets/css/style.css?retry=1";
      document.head.appendChild(retry);
    },
    { once: true }
  );

  /* ---------------- 常量与查找表 ---------------- */

  const RESIDENT_KEY = "starnest.resident.v1";
  const DRAFT_KEY = "starnest.draft.v1";
  const AUDIT_KEY = "starnest.audit.v1";

  const DEPT_BY_ID = new Map(D.DEPARTMENTS.map((dept) => [dept.id, dept]));
  const ROLE_BY_ID = new Map(D.ROLES.map((role) => [role.id, role]));

  const CHECKLIST = [
    {
      key: "badge",
      title: "领取你的数字工牌",
      desc: "工号已生成，工牌只保存在你的浏览器里。"
    },
    {
      key: "charter",
      title: "读完《星巢公约》",
      desc: "六条协作约定，决定了我们怎样一起工作。"
    },
    {
      key: "mentor",
      title: "给导师发第一条消息",
      desc: "介绍你是谁、想做什么、现在卡在哪里。"
    },
    {
      key: "task",
      title: "认领第一个岗位任务",
      desc: "不用等完美准备，先做一个最小的交付。"
    },
    {
      key: "one-on-one",
      title: "预约一次 25 分钟 1:1",
      desc: "和导师确认节奏、边界与第一周的验收标准。"
    },
    {
      key: "reflection",
      title: "写下第一周复盘",
      desc: "三句话：做了什么、学到什么、下一步是什么。"
    }
  ];

  const CHECK_KEYS = CHECKLIST.map((item) => item.key);
  const TASK_KEYS = ["t1", "t2", "t3"];
  const STEP_LABELS = ["认识你", "选航线", "工作方式", "确认承诺", "领取工牌"];
  const STEP_TITLES = ["先认识一下你", "选一条想走的航线", "说清你的工作节奏", "确认边界，然后落座"];

  const ROUTE_TITLES = {
    "/": "无限席位，等你落座",
    "/careers": "开放岗位",
    "/company": "公司手册",
    "/security": "巢盾安全",
    "/join": "线上入职",
    "/welcome": "欢迎落座",
    "/workspace": "我的工位"
  };

  const state = {
    route: { path: "/", segments: [], query: new URLSearchParams() },
    resident: null,
    draft: null,
    audit: [],
    filters: { q: "", dept: "all", level: "all" },
    joinErrors: {},
    quiz: {
      index: 0,
      answers: new Array(D.SECURITY_QUIZ.length).fill(null),
      submitted: false
    },
    compass: { index: 0, scores: {}, done: false }
  };

  let lastDialogTrigger = null;
  let revealObserver = null;
  let storageWarned = false;

  state.resident = loadResident();
  state.draft = loadDraft();
  state.audit = loadAudit();

  /* ---------------- 基础工具 ---------------- */

  function escapeHTML(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => {
      const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
      return map[ch];
    });
  }

  function cleanText(value, max) {
    if (typeof value !== "string") {
      return "";
    }
    return value
      .replace(/\r\n?/g, "\n")
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
      .trim()
      .slice(0, max);
  }

  function cleanLine(value, max) {
    return cleanText(value, max).replace(/\s+/g, " ").trim().slice(0, max);
  }

  function getDept(id) {
    return DEPT_BY_ID.get(id) || null;
  }

  function getRole(id) {
    return ROLE_BY_ID.get(id) || null;
  }

  function roleDept(role) {
    return role ? getDept(role.deptId) : null;
  }

  function safeColor(value) {
    return /^#[0-9a-f]{6}$/i.test(String(value)) ? String(value) : "#101317";
  }

  function deptStyle(dept) {
    if (!dept) {
      return "--dept:#101317;--dept-soft:#eae5d8;";
    }
    return "--dept:" + safeColor(dept.color) + ";--dept-soft:" + safeColor(dept.soft) + ";";
  }

  function icon(name, className) {
    const path = D.ICON_PATHS[name] || D.ICON_PATHS.spark;
    return (
      '<svg class="' +
      escapeHTML(className || "icon") +
      '" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      path +
      "</svg>"
    );
  }

  function initials(name) {
    const value = cleanLine(name, 20);
    if (!value) {
      return "∞";
    }
    if (/[\u4e00-\u9fa5]/.test(value)) {
      return value.slice(0, 2);
    }
    return value
      .split(/\s+/)
      .map((part) => part.charAt(0))
      .join("")
      .slice(0, 2)
      .toUpperCase();
  }

  function formatDate(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      return "—";
    }
    return (
      date.getFullYear() +
      "." +
      String(date.getMonth() + 1).padStart(2, "0") +
      "." +
      String(date.getDate()).padStart(2, "0")
    );
  }

  function formatAuditTime(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      return "—";
    }
    return (
      String(date.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(date.getDate()).padStart(2, "0") +
      " " +
      String(date.getHours()).padStart(2, "0") +
      ":" +
      String(date.getMinutes()).padStart(2, "0")
    );
  }

  function daysSince(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      return 1;
    }
    return Math.max(1, Math.ceil((Date.now() - date.getTime()) / 86400000));
  }

  function greeting() {
    const hour = new Date().getHours();
    if (hour < 6) return "夜深了";
    if (hour < 11) return "早上好";
    if (hour < 14) return "中午好";
    if (hour < 18) return "下午好";
    return "晚上好";
  }

  function readJSON(key) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function writeJSON(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      if (!storageWarned) {
        storageWarned = true;
        window.setTimeout(function () {
          toast("浏览器本地存储不可用，本次数据只保留在当前页面。", "error");
        }, 0);
      }
      return false;
    }
  }

  function removeStored(key) {
    try {
      window.localStorage.removeItem(key);
    } catch (error) {
      /* ignore */
    }
  }

  function secureRandom(max) {
    try {
      if (window.crypto && window.crypto.getRandomValues) {
        const buffer = new Uint32Array(1);
        window.crypto.getRandomValues(buffer);
        return buffer[0] % max;
      }
    } catch (error) {
      /* ignore */
    }
    return Math.floor(Math.random() * max);
  }

  function makeResidentId() {
    const year = new Date().getFullYear();
    return "SN-" + year + "-" + String(secureRandom(10000)).padStart(4, "0");
  }

  function makeDefaultForm() {
    return {
      name: "",
      school: "",
      major: "",
      grade: D.GRADES[0],
      hours: D.HOURS[1],
      start: D.START_OPTIONS[0],
      workStyle: D.WORK_STYLES[0]
    };
  }

  function makeDefaultDraft() {
    return {
      step: 0,
      form: makeDefaultForm(),
      roleId: "",
      skills: [],
      motivation: "",
      consents: { practice: false, privacy: false, honesty: false }
    };
  }

  /* ---------------- 持久化与校验 ---------------- */

  function validateResident(raw) {
    if (!raw || typeof raw !== "object") {
      return null;
    }
    const role = getRole(raw.roleId);
    if (!role) {
      return null;
    }
    const name = cleanLine(raw.name, 20);
    if (name.length < 2) {
      return null;
    }
    const joined = new Date(raw.joinedAt);
    const joinedAt = Number.isNaN(joined.getTime()) ? new Date().toISOString() : joined.toISOString();
    const skills = Array.isArray(raw.skills)
      ? raw.skills.filter((skill) => D.SKILLS.includes(skill)).slice(0, 3)
      : role.skills.slice(0, 2);
    const checklist = {};
    CHECK_KEYS.forEach((key) => {
      checklist[key] = Boolean(raw.checklist && raw.checklist[key]);
    });
    const tasks = {};
    TASK_KEYS.forEach((key) => {
      tasks[key] = Boolean(raw.tasks && raw.tasks[key]);
    });
    const reflections = Array.isArray(raw.reflections)
      ? raw.reflections
          .filter((entry) => entry && typeof entry === "object")
          .map((entry) => {
            const did = cleanText(entry.did, 160);
            const learned = cleanText(entry.learned, 160);
            const next = cleanText(entry.next, 80);
            const week = Math.min(8, Math.max(1, Number(entry.week) || 1));
            const created = new Date(entry.createdAt);
            return {
              id: cleanLine(entry.id, 24) || "log-" + week,
              week: week,
              did: did,
              learned: learned,
              next: next,
              createdAt: Number.isNaN(created.getTime()) ? new Date().toISOString() : created.toISOString()
            };
          })
          .filter((entry) => entry.did || entry.learned || entry.next)
          .slice(-8)
      : [];
    const idPattern = /^SN-\d{4}-\d{4}$/;
    return {
      version: 1,
      id: idPattern.test(String(raw.id)) ? String(raw.id) : makeResidentId(),
      name: name,
      school: cleanLine(raw.school, 40),
      major: cleanLine(raw.major, 30),
      grade: D.GRADES.includes(raw.grade) ? raw.grade : D.GRADES[0],
      hours: D.HOURS.includes(raw.hours) ? raw.hours : D.HOURS[1],
      start: D.START_OPTIONS.includes(raw.start) ? raw.start : D.START_OPTIONS[0],
      workStyle: D.WORK_STYLES.includes(raw.workStyle) ? raw.workStyle : D.WORK_STYLES[0],
      roleId: role.id,
      skills: skills,
      motivation: cleanText(raw.motivation, 200),
      joinedAt: joinedAt,
      status: raw.status === "paused" ? "paused" : "active",
      checklist: checklist,
      tasks: tasks,
      reflections: reflections
    };
  }

  function loadResident() {
    return validateResident(readJSON(RESIDENT_KEY));
  }

  function saveResident() {
    if (!state.resident) {
      return false;
    }
    return writeJSON(RESIDENT_KEY, state.resident);
  }

  function loadDraft() {
    const fallback = makeDefaultDraft();
    const raw = readJSON(DRAFT_KEY);
    if (!raw || typeof raw !== "object") {
      return fallback;
    }
    const form = raw.form && typeof raw.form === "object" ? raw.form : {};
    const draft = {
      step: Math.min(3, Math.max(0, Number(raw.step) || 0)),
      form: {
        name: cleanLine(form.name, 20),
        school: cleanLine(form.school, 40),
        major: cleanLine(form.major, 30),
        grade: D.GRADES.includes(form.grade) ? form.grade : D.GRADES[0],
        hours: D.HOURS.includes(form.hours) ? form.hours : D.HOURS[1],
        start: D.START_OPTIONS.includes(form.start) ? form.start : D.START_OPTIONS[0],
        workStyle: D.WORK_STYLES.includes(form.workStyle) ? form.workStyle : D.WORK_STYLES[0]
      },
      roleId: getRole(raw.roleId) ? raw.roleId : "",
      skills: Array.isArray(raw.skills)
        ? raw.skills.filter((skill) => D.SKILLS.includes(skill)).slice(0, 3)
        : [],
      motivation: cleanText(raw.motivation, 200),
      consents: { practice: false, privacy: false, honesty: false }
    };

    const identityReady =
      cleanLine(draft.form.name, 20).length >= 2 &&
      cleanLine(draft.form.school, 40).length >= 2 &&
      cleanLine(draft.form.major, 30).length >= 2;
    const roleReady =
      Boolean(getRole(draft.roleId)) &&
      draft.skills.length >= 1 &&
      draft.skills.length <= 3 &&
      cleanText(draft.motivation, 200).length >= 10;
    if (!identityReady) {
      draft.step = 0;
    } else if (draft.step > 1 && !roleReady) {
      draft.step = 1;
    }
    return draft;
  }

  function saveDraft() {
    return writeJSON(DRAFT_KEY, state.draft);
  }

  function loadAudit() {
    const raw = readJSON(AUDIT_KEY);
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw
      .filter((entry) => entry && typeof entry.at === "string" && typeof entry.action === "string")
      .slice(0, 60)
      .map((entry) => ({
        at: new Date(entry.at).toString() === "Invalid Date" ? new Date().toISOString() : entry.at,
        action: cleanLine(entry.action, 80),
        actor: cleanLine(entry.actor, 12) || "本地用户"
      }));
  }

  function addAudit(action) {
    const entry = {
      at: new Date().toISOString(),
      action: cleanLine(action, 80),
      actor: state.resident ? cleanLine(state.resident.name, 12) : "访客"
    };
    state.audit.unshift(entry);
    state.audit = state.audit.slice(0, 60);
    writeJSON(AUDIT_KEY, state.audit);
    if (state.route.path === "/security") {
      refreshAuditPanel();
    }
  }

  /* ---------------- 路由 ---------------- */

  function parseHash() {
    let raw = window.location.hash.replace(/^#/, "");
    if (!raw || raw === "/") {
      raw = "/";
    }
    const parts = raw.split("?");
    const path = "/" + parts[0].split("/").filter(Boolean).join("/");
    return {
      path: path,
      segments: path.split("/").filter(Boolean),
      query: new URLSearchParams(parts[1] || "")
    };
  }

  function navigate(path) {
    if (window.location.hash === "#" + path || window.location.hash === path) {
      renderRoute();
      return;
    }
    window.location.hash = path;
  }

  function renderRoute() {
    const path = state.route.path;

    if (path === "/welcome" && !state.resident) {
      window.location.replace("#/join");
      return;
    }

    let html = "";
    switch (path) {
      case "/":
        html = homeMarkup();
        break;
      case "/careers":
        html = careersMarkup();
        break;
      case "/company":
        html = companyMarkup();
        break;
      case "/security":
        html = securityMarkup();
        break;
      case "/join":
        html = joinMarkup();
        break;
      case "/welcome":
        html = welcomeMarkup();
        break;
      case "/workspace":
        html = workspaceMarkup();
        break;
      default:
        html = notFoundMarkup();
        break;
    }

    app.innerHTML = html;
    updateChrome();
    document.title =
      (ROUTE_TITLES[path] || "这条航线还没开通") + " · 星巢无限 STARNEST ∞";
    initReveal();
    try {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    } catch (error) {
      window.scrollTo(0, 0);
    }
    main.focus({ preventScroll: true });
  }

  function updateChrome() {
    const headerCta = document.querySelector(".header-cta");
    const workspaceLink = document.getElementById("workspace-link");

    if (headerCta) {
      if (state.resident) {
        headerCta.setAttribute("href", "#/workspace");
        headerCta.innerHTML =
          '进入工位 <span class="btn-arrow" aria-hidden="true">↗</span>';
      } else {
        headerCta.setAttribute("href", "#/join");
        headerCta.innerHTML =
          '立即入职 <span class="btn-arrow" aria-hidden="true">↗</span>';
      }
    }

    if (workspaceLink) {
      const label = workspaceLink.querySelector("span:last-child");
      if (label) {
        label.textContent = state.resident ? state.resident.name.slice(0, 8) : "我的工位";
      }
      workspaceLink.classList.toggle("is-onboard", Boolean(state.resident));
    }

    const path = state.route.path;
    document.querySelectorAll("[data-nav]").forEach((link) => {
      const nav = link.getAttribute("data-nav");
      let active = false;
      if (nav === "home") {
        active = path === "/";
      } else if (nav === "careers") {
        active = path === "/careers";
      } else if (nav === "company") {
        active = path === "/company";
      } else if (nav === "security") {
        active = path === "/security";
      }
      link.classList.toggle("is-active", active);
      if (active) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    });
  }

  function initReveal() {
    if (revealObserver) {
      revealObserver.disconnect();
      revealObserver = null;
    }
    const items = Array.from(document.querySelectorAll("[data-reveal]"));
    if (!items.length) {
      return;
    }
    if (!("IntersectionObserver" in window)) {
      items.forEach((item) => item.classList.add("is-revealed"));
      return;
    }
    revealObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-revealed");
            revealObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1, rootMargin: "0px 0px -24px 0px" }
    );
    items.forEach((item) => revealObserver.observe(item));
  }

  /* ---------------- 弹窗与提示 ---------------- */

  function openDialog(html, trigger) {
    const dialog = document.getElementById("site-dialog");
    const content = document.getElementById("dialog-content");
    if (!dialog || !content) {
      return;
    }
    lastDialogTrigger = trigger || document.activeElement;
    content.innerHTML = html;
    if (typeof dialog.showModal === "function") {
      if (!dialog.open) {
        dialog.showModal();
      }
    } else {
      dialog.setAttribute("open", "open");
    }
    document.body.style.overflow = "hidden";
    const shell = dialog.querySelector(".dialog-shell");
    if (shell) {
      shell.scrollTop = 0;
    }
    const close = dialog.querySelector(".dialog-close");
    if (close) {
      close.focus();
    }
  }

  function closeDialog(silent) {
    const dialog = document.getElementById("site-dialog");
    if (!dialog) {
      return;
    }
    if (dialog.open && typeof dialog.close === "function") {
      dialog.close();
    } else {
      dialog.removeAttribute("open");
    }
    document.body.style.overflow = "";
    const content = document.getElementById("dialog-content");
    if (content) {
      content.innerHTML = "";
    }
    if (!silent && lastDialogTrigger && document.contains(lastDialogTrigger)) {
      lastDialogTrigger.focus();
    }
  }

  function toast(message, type) {
    const region = document.getElementById("toast-region");
    if (!region) {
      return;
    }
    const item = document.createElement("div");
    item.className = "toast" + (type === "error" ? " is-error" : "");
    item.setAttribute("role", "status");
    item.textContent = message;
    while (region.children.length >= 2) {
      region.removeChild(region.firstElementChild);
    }
    region.appendChild(item);
    window.setTimeout(function () {
      if (item.parentNode) {
        item.parentNode.removeChild(item);
      }
    }, 3800);
  }

  /* ---------------- 首页 ---------------- */

  function homeMarkup() {
    const tickerItems = [
      "8 个部门",
      "31 个岗位",
      "∞ 个工位",
      "0 元参与",
      "8 周实践",
      "1 位导师",
      "不打卡",
      "允许暂停",
      "数据留在本地",
      "巢盾安全"
    ];
    const ticker = tickerItems
      .concat(tickerItems)
      .map((item) => "<span>" + escapeHTML(item) + "</span>")
      .join("");

    const featuredIds = [
      "frontend-engineer",
      "product-manager",
      "security-engineer",
      "brand-content",
      "ux-researcher",
      "customer-success-manager"
    ];
    const featured = featuredIds
      .map((id) => getRole(id))
      .filter(Boolean)
      .map((role) => roleCardMarkup(role))
      .join("");

    return `
      <section class="hero">
        <div class="container">
          <div class="hero-grid">
            <div class="hero-copy">
              <div class="hero-kicker">
                <span class="pill pill-lime">2026 校招季 · 反焦虑实验</span>
                <span class="pill">远程 / 异步优先</span>
                <span class="pill">非真实劳动关系</span>
              </div>
              <h1>
                <span class="line">无限席位</span>
                <span class="line">等你<em>落座</em><span class="hero-infinity" aria-hidden="true">∞</span></span>
              </h1>
              <p class="hero-lead">
                星巢是一间没有围墙的线上公司。8 个部门、31 个岗位、<strong>无限工位</strong>，向每一位正在寻找方向的在校生开放。没有截止日期，没有名额限制，也不需要一份完美的简历。
              </p>
              <div class="hero-actions">
                <a class="btn btn-primary btn-lg" href="#/join">
                  5 分钟线上入职
                  <span class="btn-arrow" aria-hidden="true">↗</span>
                </a>
                <button class="btn btn-ghost btn-lg" type="button" data-action="open-compass">
                  ${icon("compass")}
                  打开岗位罗盘
                </button>
              </div>
              <div class="hero-foot">
                <span>无需投递简历</span>
                <span>岗位不设名额</span>
                <span>数据只存本地</span>
                <span>随时可以退出</span>
              </div>
            </div>

            <div class="hero-visual" aria-hidden="true">
              <div class="orbit-stage">
                <div class="orbit orbit-three"></div>
                <div class="orbit orbit-two"></div>
                <div class="orbit orbit-one"></div>
                <span class="orbit-tag tag-product">产品 / PRD</span>
                <span class="orbit-tag tag-tech">技术 / TEC</span>
                <span class="orbit-tag tag-security">安全 / SEC</span>
                <span class="orbit-tag tag-design">设计 / UX</span>
                <span class="orbit-tag tag-ops">运营 / STR</span>
                <span class="orbit-tag tag-content">内容 / MKT</span>
                <div class="orbit-core">
                  <strong>∞</strong>
                  <small>STARNEST / OPEN</small>
                </div>
              </div>
              <div class="hero-pass">
                <div>
                  <span class="hero-pass-label">RESIDENT PASS / 无限工位</span>
                  <strong>下一位落座者，可能就是你</strong>
                </div>
                <div class="hero-pass-meta">
                  SEAT ∞<br>ISSUE 2026
                </div>
                <div class="hero-pass-barcode"></div>
              </div>
            </div>
          </div>

          <div class="hero-stats">
            <div class="hero-stat">
              <strong>08</strong>
              <span>Departments / 部门</span>
            </div>
            <div class="hero-stat">
              <strong>${String(D.ROLES.length).padStart(2, "0")}</strong>
              <span>Open roles / 岗位</span>
            </div>
            <div class="hero-stat">
              <strong>∞</strong>
              <span>Seats / 工位</span>
            </div>
            <div class="hero-stat">
              <strong>00</strong>
              <span>Fee / 参与费用</span>
            </div>
          </div>
        </div>
      </section>

      <div class="ticker" aria-hidden="true">
        <div class="ticker-track">${ticker}</div>
      </div>

      <section class="section">
        <div class="container">
          <div class="manifesto-grid" data-reveal>
            <div>
              <span class="eyebrow">Why Starnest / 关于入口</span>
              <p class="manifesto-statement" style="margin-top: 22px;">
                不是另一场<br>
                <span class="strike">完美简历</span> 的筛选，<br>
                而是一次被接住的<em>落座</em>。
              </p>
              <div class="manifesto-stats">
                <div class="manifesto-stat">
                  <strong>8 周</strong>
                  <span>一段完整的实践周期</span>
                </div>
                <div class="manifesto-stat">
                  <strong>5h+</strong>
                  <span>每周最低投入，可暂停</span>
                </div>
                <div class="manifesto-stat">
                  <strong>1:1</strong>
                  <span>导师带教，不是放养</span>
                </div>
              </div>
            </div>
            <div class="manifesto-copy">
              <p>
                我们见过太多“已读不回”的招聘页面：岗位写着“欢迎应届生”，流程却要求三年经验；页面说“我们重视成长”，第一轮却先筛掉没有大厂实习的人。
              </p>
              <p>
                星巢想反过来做一次实验：<strong>先把入口做宽，再让作品说话。</strong> 你可以从 31 个岗位里选一个起点，用 8 周做一件真实的小事，带走一份能讲清楚的作品与复盘。
              </p>
              <div class="manifesto-note">
                星巢是虚构的概念公司与交互演示，不构成真实劳动关系、招聘承诺或薪酬承诺。这里没有工资，也不会用焦虑换流量。
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="section section-tight">
        <div class="container">
          <div class="section-head-row" data-reveal>
            <div>
              <span class="eyebrow">What we believe / 我们相信</span>
              <h2>四件小事，<br>决定我们怎么一起工作。</h2>
            </div>
            <a class="text-link" href="#/company">阅读公司手册 <span aria-hidden="true">↗</span></a>
          </div>
          <div class="values-grid" data-reveal>
            ${D.VALUES.map(
              (value) => `
              <article class="value-card">
                <span class="value-no">${escapeHTML(value.no)} / 04</span>
                <h3>${escapeHTML(value.title)}</h3>
                <p>${escapeHTML(value.text)}</p>
              </article>`
            ).join("")}
          </div>
        </div>
      </section>

      <section class="section">
        <div class="container">
          <div class="section-head" data-reveal>
            <div>
              <span class="eyebrow">Departments / 组织</span>
              <h2>8 条航线，<br>总有一条适合现在的你。</h2>
            </div>
            <div class="section-head-copy">
              <p>
                从战略到安全，从产品到客户成功。每个部门都由一位虚构负责人带教，每个岗位都有一条能留下作品的真实任务线。
              </p>
              <a class="text-link" href="#/careers">查看全部 ${D.ROLES.length} 个岗位 <span aria-hidden="true">↗</span></a>
            </div>
          </div>
          <div class="dept-grid">
            ${D.DEPARTMENTS.map(deptCardMarkup).join("")}
          </div>
        </div>
      </section>

      <section class="section section-tight" style="background: var(--paper-deep); border-block: 1px solid var(--line-strong);">
        <div class="container">
          <div class="section-head-row" data-reveal>
            <div>
              <span class="eyebrow">Open roles / 先选一个开始的位置</span>
              <h2>不用一步到位，<br>先选一个能开始的地方。</h2>
            </div>
            <a class="text-link" href="#/careers">全部岗位 <span aria-hidden="true">↗</span></a>
          </div>
          <div class="role-grid">
            ${featured}
          </div>
        </div>
      </section>

      <section class="section journey-section">
        <div class="container">
          <div class="journey-layout">
            <div class="journey-intro" data-reveal>
              <span class="eyebrow">How it works / 入职路径</span>
              <h2>从点开，到落座，<br>只需要 5 步。</h2>
              <p>
                没有笔试、没有群面、没有“回去等通知”。你只需要说清自己现在在哪里，想去哪里，然后领走一张只属于你的数字工牌。
              </p>
              <a class="btn btn-primary" href="#/join">
                开始线上入职
                <span class="btn-arrow" aria-hidden="true">↗</span>
              </a>
            </div>
            <div class="journey-steps" data-reveal>
              ${[
                ["01", "认识你", "昵称、学校、专业、当前阶段。不用真名，也不用一份完美简历。", "约 1 分钟"],
                ["02", "选一条航线", "8 个部门、31 个岗位。不确定就用岗位罗盘，用 3 个问题找到一个起点。", "约 2 分钟"],
                ["03", "说清你的节奏", "每周能投入多久、什么时候开始、喜欢怎样工作。我们按你的真实情况匹配。", "约 1 分钟"],
                ["04", "确认边界", "阅读实践承诺与隐私说明。席位无限，但责任有界。", "约 1 分钟"],
                ["05", "领取工牌", "即时生成工号、数字工牌与第一周清单。从“被接住”开始。", "即时"]
              ]
                .map(
                  (step) => `
                <article class="journey-step">
                  <span class="step-no">${step[0]}</span>
                  <div>
                    <h3>${step[1]}</h3>
                    <p>${step[2]}</p>
                    <span class="step-meta">${step[3]}</span>
                  </div>
                </article>`
                )
                .join("")}
            </div>
          </div>
        </div>
      </section>

      ${securityBandMarkup()}

      <section class="final-cta">
        <div class="container final-cta-inner">
          <span class="eyebrow">Your seat is waiting / 席位正在等你</span>
          <h2 style="margin-top: 20px;">
            <span>先坐下来。</span>
            <span><em>再决定</em>你要成为谁。</span>
          </h2>
          <div class="final-cta-bottom">
            <p>
              不用等准备好，也不用先证明什么。5 分钟后，你会有一张工牌、一位导师和一个可以开始的小任务。
            </p>
            <a class="btn btn-primary btn-lg" href="#/join">
              领取我的工位
              <span class="btn-arrow" aria-hidden="true">↗</span>
            </a>
          </div>
        </div>
      </section>
    `;
  }

  function deptCardMarkup(dept) {
    const count = D.ROLES.filter((role) => role.deptId === dept.id).length;
    return `
      <a class="dept-card" href="#/careers" data-dept-link="${escapeHTML(dept.id)}" style="${deptStyle(dept)}" data-reveal>
        <span class="dept-card-top">
          <span class="dept-icon" aria-hidden="true">${icon(dept.icon)}</span>
          <span class="dept-code">${escapeHTML(dept.code)} / ${String(count).padStart(2, "0")} ROLES</span>
        </span>
        <h3>${escapeHTML(dept.name)}</h3>
        <span class="dept-en">${escapeHTML(dept.en)}</span>
        <p class="dept-mission">${escapeHTML(dept.mission)}</p>
        <span class="dept-foot">
          <span><b>${escapeHTML(dept.lead)}</b>${escapeHTML(dept.leadRole)}</span>
          <span class="dept-arrow" aria-hidden="true">↗</span>
        </span>
      </a>
    `;
  }

  function securityBandMarkup() {
    return `
      <section class="security-band">
        <div class="container">
          <div class="security-band-grid">
            <div data-reveal>
              <span class="eyebrow">NEST SHIELD / 巢盾安全</span>
              <h2>无限容量，<br>不等于<em>无边界</em>。</h2>
              <p class="security-band-copy">
                我们把“保护住户”写进产品，而不是写在发布之后。数据最小化、零第三方依赖、输出编码、可导出与可删除——这些不是口号，是本站已经落地的默认设置。
              </p>
              <div class="security-mini-stats">
                <div class="security-mini-stat">
                  <strong>0</strong>
                  <span>第三方脚本</span>
                </div>
                <div class="security-mini-stat">
                  <strong>0</strong>
                  <span>敏感字段收集</span>
                </div>
                <div class="security-mini-stat">
                  <strong>60</strong>
                  <span>本地审计上限</span>
                </div>
              </div>
              <a class="btn btn-lime" href="#/security">
                进入巢盾安全中心
                <span class="btn-arrow" aria-hidden="true">↗</span>
              </a>
            </div>
            <div class="terminal-card" data-reveal>
              <div class="terminal-bar">
                <span class="terminal-dot"></span>
                <span class="terminal-dot"></span>
                <span class="terminal-dot"></span>
                <span>nest-shield / baseline check</span>
              </div>
              <div class="terminal-body">
                <div><span class="prompt">nest@starnest</span>:~$ ./shield --check</div>
                <div class="comment"># 检查公开入口与数据边界</div>
                <div><span class="ok">✓</span> CSP / X-Frame-Options / nosniff</div>
                <div><span class="ok">✓</span> 用户输入 → 校验 → 编码 → 渲染</div>
                <div><span class="ok">✓</span> 0 个第三方脚本 · 0 个远程字体</div>
                <div><span class="ok">✓</span> localStorage only · export / delete ready</div>
                <div><span class="warn">!</span> production SSO / RBAC：蓝图，未启用</div>
                <div><span class="prompt">nest@starnest</span>:~$ <span class="ok">_</span></div>
              </div>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  /* ---------------- 岗位卡片与筛选 ---------------- */

  function roleCardMarkup(role) {
    const dept = roleDept(role);
    return `
      <article class="role-card" style="${deptStyle(dept)}" data-role="${escapeHTML(role.id)}">
        <div class="role-card-top">
          <span class="role-dept">${escapeHTML(dept ? dept.name : "星巢")}</span>
          <span class="role-level">${escapeHTML(role.level)}</span>
        </div>
        <h3>${escapeHTML(role.title)}</h3>
        <p>${escapeHTML(role.summary)}</p>
        <div class="skill-tags">
          ${role.skills.map((skill) => '<span class="skill-tag">' + escapeHTML(skill) + "</span>").join("")}
        </div>
        <div class="role-card-foot">
          <span><b>∞ 席位</b> · ${escapeHTML(role.type)}</span>
          <a class="role-card-cta" href="#/careers">查看岗位 <span aria-hidden="true">↗</span></a>
        </div>
      </article>
    `;
  }

  function filteredRoles() {
    const q = state.filters.q.trim().toLowerCase();
    return D.ROLES.filter((role) => {
      const dept = roleDept(role);
      if (state.filters.dept !== "all" && role.deptId !== state.filters.dept) {
        return false;
      }
      if (state.filters.level !== "all" && role.level !== state.filters.level) {
        return false;
      }
      if (!q) {
        return true;
      }
      const haystack = [
        role.title,
        role.summary,
        role.level,
        role.type,
        dept ? dept.name : "",
        dept ? dept.en : ""
      ]
        .concat(role.skills)
        .join(" ")
        .toLowerCase();
      return haystack.indexOf(q) !== -1;
    });
  }

  function filterChipsMarkup() {
    const chips = [
      `<button class="filter-chip${state.filters.dept === "all" ? " is-active" : ""}" type="button" data-filter-dept="all">全部 <b>${D.ROLES.length}</b></button>`
    ];
    D.DEPARTMENTS.forEach((dept) => {
      const count = D.ROLES.filter((role) => role.deptId === dept.id).length;
      chips.push(
        `<button class="filter-chip${state.filters.dept === dept.id ? " is-active" : ""}" type="button" data-filter-dept="${escapeHTML(
          dept.id
        )}">${escapeHTML(dept.name.replace("部", ""))} <b>${count}</b></button>`
      );
    });
    return chips.join("");
  }

  function resultsMetaMarkup(count) {
    const active = state.filters.q || state.filters.dept !== "all" || state.filters.level !== "all";
    return `
      <p>找到 <b>${count}</b> 个岗位 · 共 ${D.ROLES.length} 个 · 席位无限</p>
      <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;">
        ${
          active
            ? '<button class="text-link" type="button" data-action="clear-filters" style="background:none;border-top:0;border-left:0;border-right:0;padding:0 0 2px;">清除筛选</button>'
            : ""
        }
        <button class="btn btn-sm btn-lime" type="button" data-action="open-compass">
          ${icon("compass")} 岗位罗盘
        </button>
      </div>
    `;
  }

  function emptyRolesMarkup() {
    return `
      <div class="empty-state">
        <div class="empty-mark" aria-hidden="true">∅</div>
        <h3>这条航线上暂时没有匹配的岗位</h3>
        <p>换一个关键词或部门试试。所有岗位都不设名额，也不需要排队。</p>
        <button class="btn btn-primary" type="button" data-action="clear-filters">清除筛选</button>
      </div>
    `;
  }

  function updateCareersResults() {
    const results = filteredRoles();
    const list = document.getElementById("role-results");
    const meta = document.getElementById("results-meta");
    const deptSelect = document.getElementById("dept-filter");
    const levelSelect = document.getElementById("level-filter");
    if (list) {
      list.innerHTML = results.length
        ? results.map((role) => roleCardMarkup(role)).join("")
        : emptyRolesMarkup();
    }
    if (meta) {
      meta.innerHTML = resultsMetaMarkup(results.length);
    }
    if (deptSelect) {
      deptSelect.value = state.filters.dept;
    }
    if (levelSelect) {
      levelSelect.value = state.filters.level;
    }
    document.querySelectorAll("[data-filter-dept]").forEach((chip) => {
      chip.classList.toggle("is-active", chip.dataset.filterDept === state.filters.dept);
    });
  }

  /* ---------------- 开放岗位页 ---------------- */

  function careersMarkup() {
    const results = filteredRoles();
    return `
      <section class="page-hero">
        <div class="container">
          <div class="page-hero-grid">
            <div>
              <span class="eyebrow">Open roles / 不设截止日期</span>
              <h1>先选一个<br>能<em>开始</em>的位置。</h1>
              <p class="page-hero-copy">
                8 个部门、${D.ROLES.length} 个岗位，全部不设名额。没有“只招 2 人”，也没有“需三年经验”。你可以按部门、职级或关键词找到第一个想试的方向。
              </p>
              <div class="page-actions">
                <button class="btn btn-primary" type="button" data-action="open-compass">
                  ${icon("compass")} 用 3 个问题找到方向
                </button>
                <a class="btn btn-ghost" href="#/join">直接入职 <span class="btn-arrow" aria-hidden="true">↗</span></a>
              </div>
            </div>
            <aside class="page-hero-aside">
              <strong>${D.ROLES.length}</strong>
              <span>OPEN ROLES / 全部开放</span>
              <p>每个岗位都配有任务包、导师与 8 周实践路径。方向可以换，次数不设限。</p>
            </aside>
          </div>
        </div>
      </section>

      <section class="careers-toolbar">
        <div class="container">
          <div class="toolbar-top">
            <div class="search-field">
              ${icon("search")}
              <input id="role-search" type="search" autocomplete="off" placeholder="搜索岗位、技能或部门，例如：安全 / SQL / 内容" aria-label="搜索岗位" value="${escapeHTML(
                state.filters.q
              )}">
            </div>
            <div class="select-field">
              <select id="dept-filter" aria-label="按部门筛选">
                <option value="all">全部部门</option>
                ${D.DEPARTMENTS.map(
                  (dept) =>
                    `<option value="${escapeHTML(dept.id)}" ${
                      state.filters.dept === dept.id ? "selected" : ""
                    }>${escapeHTML(dept.name)}</option>`
                ).join("")}
              </select>
            </div>
            <div class="select-field">
              <select id="level-filter" aria-label="按职级筛选">
                <option value="all">全部职级</option>
                ${D.LEVELS.map(
                  (level) =>
                    `<option value="${escapeHTML(level)}" ${
                      state.filters.level === level ? "selected" : ""
                    }>${escapeHTML(level)}</option>`
                ).join("")}
              </select>
            </div>
          </div>
          <div class="filter-chips" id="filter-chips">
            ${filterChipsMarkup()}
          </div>
        </div>
      </section>

      <section class="careers-results">
        <div class="container">
          <div class="results-meta" id="results-meta">
            ${resultsMetaMarkup(results.length)}
          </div>
          <div class="role-grid" id="role-results">
            ${results.length ? results.map((role) => roleCardMarkup(role)).join("") : emptyRolesMarkup()}
          </div>
        </div>
      </section>

      <section class="final-cta">
        <div class="container final-cta-inner">
          <span class="eyebrow">Still unsure? / 还没想好也没关系</span>
          <h2 style="margin-top: 20px;">
            <span>方向可以慢慢找，</span>
            <span><em>工位</em>可以先坐下。</span>
          </h2>
          <div class="final-cta-bottom">
            <p>先以任意岗位入职，完成前 4 周后再申请横向探索。内部转岗不设次数，也不需要重新证明自己。</p>
            <a class="btn btn-primary btn-lg" href="#/join">先领一张工牌 <span class="btn-arrow" aria-hidden="true">↗</span></a>
          </div>
        </div>
      </section>
    `;
  }

  /* ---------------- 岗位详情弹窗 ---------------- */

  function openRoleDialog(roleId, trigger) {
    const role = getRole(roleId);
    if (!role) {
      toast("没有找到这个岗位。", "error");
      return;
    }
    const dept = roleDept(role);
    const html = `
      <div class="role-dialog" style="${deptStyle(dept)}">
        <div class="dialog-kicker">ROLE / ${escapeHTML(role.id)}</div>
        <span class="dialog-dept">${escapeHTML(dept ? dept.name : "星巢")} · ${escapeHTML(role.level)}</span>
        <h2 id="dialog-title">${escapeHTML(role.title)}</h2>
        <p class="role-dialog-summary">${escapeHTML(role.summary)}</p>
        <div class="role-meta-row">
          <span class="pill">${escapeHTML(role.type)}</span>
          <span class="pill">${escapeHTML(D.PRACTICE_COMMITMENT)}</span>
          <span class="pill">∞ 席位 · 无需排队</span>
        </div>

        <div class="dialog-two-col">
          <div class="dialog-section">
            <h3>你会做什么</h3>
            <ul class="detail-list">
              ${role.responsibilities.map((item) => "<li>" + escapeHTML(item) + "</li>").join("")}
            </ul>
          </div>
          <div class="dialog-section">
            <h3>我们期待什么</h3>
            <ul class="detail-list">
              ${role.requirements.map((item) => "<li>" + escapeHTML(item) + "</li>").join("")}
            </ul>
          </div>
        </div>

        <div class="dialog-section">
          <h3>你需要带来的能力</h3>
          <div class="skill-tags">
            ${role.skills.map((skill) => '<span class="skill-tag">' + escapeHTML(skill) + "</span>").join("")}
          </div>
        </div>

        <div class="dialog-callout">
          <span>First mission / 入职后的第一个任务</span>
          <p>${escapeHTML(role.mission)}</p>
        </div>

        <div class="dialog-section">
          <h3>${escapeHTML(dept ? dept.name : "部门")}的 4 周带教路径</h3>
          <ol class="plan-list">
            ${(dept ? dept.plan : []).map((item) => "<li>" + escapeHTML(item) + "</li>").join("")}
          </ol>
        </div>

        <div class="dialog-actions">
          <button class="btn btn-primary" type="button" data-action="apply-role" data-role-id="${escapeHTML(role.id)}">
            以这个岗位入职
            <span class="btn-arrow" aria-hidden="true">↗</span>
          </button>
          <button class="btn btn-ghost" type="button" data-action="close-dialog">再看看</button>
        </div>
      </div>
    `;
    openDialog(html, trigger);
  }

  function applyRole(roleId) {
    const role = getRole(roleId);
    if (!role) {
      return;
    }
    const hadResident = Boolean(state.resident);
    if (hadResident) {
      const confirmed = window.confirm(
        "你已有一个工位。重新入职会覆盖当前工位的本地记录（清单、任务与审计仍会保留，直到你确认完成新入职）。继续吗？"
      );
      if (!confirmed) {
        return;
      }
    }
    const draft = makeDefaultDraft();
    draft.roleId = role.id;
    if (hadResident) {
      const resident = state.resident;
      draft.form = {
        name: resident.name,
        school: resident.school,
        major: resident.major,
        grade: resident.grade,
        hours: resident.hours,
        start: resident.start,
        workStyle: resident.workStyle
      };
      draft.skills = resident.skills.slice(0, 3);
      draft.motivation = resident.motivation;
      draft.step = 1;
    }
    state.draft = draft;
    state.joinErrors = {};
    saveDraft();
    closeDialog(true);
    navigate("/join");
    toast(hadResident ? `已把「${role.title}」带入重新入职流程。` : `已把「${role.title}」带入入职表。`);
  }

  /* ---------------- 公司手册 ---------------- */

  function companyMarkup() {
    return `
      <section class="company-hero">
        <div class="container">
          <span class="eyebrow">Company handbook / 公司手册 · 2026 版</span>
          <h1>把“找工作”，<br>改成“先<em>坐下</em>”。</h1>
          <p class="page-hero-copy" style="position: relative; z-index: 2;">
            星巢是一个虚构的线上概念公司，也是一场关于“入口”的社会实验。我们想验证：如果把筛选拿掉，把带教补上，年轻人会不会更敢开始？
          </p>
          <div class="company-facts">
            <div class="company-fact"><span>Founded / 成立</span><strong>${escapeHTML(D.COMPANY.founded)}</strong></div>
            <div class="company-fact"><span>Headquarters / 总部</span><strong>${escapeHTML(D.COMPANY.hq)}</strong></div>
            <div class="company-fact"><span>Scale / 规模</span><strong>${escapeHTML(D.COMPANY.size)}</strong></div>
            <div class="company-fact"><span>Mode / 模式</span><strong>${escapeHTML(D.COMPANY.mode)}</strong></div>
          </div>
        </div>
      </section>

      <section class="section">
        <div class="container">
          <div class="story-grid" data-reveal>
            <div>
              <span class="eyebrow">Origin / 我们为什么开始</span>
              <h2 style="margin-top: 18px;">入口不该<br>这么<em>窄</em>。</h2>
            </div>
            <div class="story-copy">
              <p>
                我们不是在解决“岗位不够”，而是在解决“入口太窄”。当一个学生需要先有一份好实习，才能申请下一份好实习时，这个循环本身就把很多人挡在了门外。
              </p>
              <p>
                <strong>星巢的做法很笨：先给一个真实的起点。</strong> 一个岗位、一位导师、一条 8 周的任务线。做得好不好，用作品和复盘说话；适不适合，做完再判断。
              </p>
              <p>
                我们不承诺薪资，也不假装这是一份正式工作。我们只承诺三件事：不设名额、不卖课程、不收集你的敏感信息。
              </p>
            </div>
          </div>
        </div>
      </section>

      <section class="section section-tight" style="background: var(--paper-deep); border-block: 1px solid var(--line-strong);">
        <div class="container">
          <div class="section-head" data-reveal>
            <div>
              <span class="eyebrow">People / 虚构的带教者</span>
              <h2>他们不是 HR，<br>是第一批把门打开的人。</h2>
            </div>
            <div class="section-head-copy">
              <p>以下人物均为虚构设定，仅用于呈现这家概念公司的组织方式。他们不代表任何真实个人或机构。</p>
            </div>
          </div>
          <div class="leader-grid">
            ${D.LEADERS.map(
              (leader) => `
              <article class="leader-card" data-reveal>
                <div class="leader-head">
                  <span class="leader-avatar" aria-hidden="true">${escapeHTML(leader.initials)}</span>
                  <div>
                    <h3>${escapeHTML(leader.name)}</h3>
                    <span class="leader-role">${escapeHTML(leader.role)}</span>
                  </div>
                </div>
                <p class="leader-quote">${escapeHTML(leader.quote)}</p>
                <p class="leader-bio">${escapeHTML(leader.bio)}</p>
              </article>`
            ).join("")}
          </div>
        </div>
      </section>

      <section class="section">
        <div class="container">
          <div class="section-head-row" data-reveal>
            <div>
              <span class="eyebrow">Organization / 组织架构</span>
              <h2>一张图，<br>看清谁为结果负责。</h2>
            </div>
            <a class="text-link" href="#/careers">查看开放岗位 <span aria-hidden="true">↗</span></a>
          </div>
          <div class="org-map" data-reveal>
            <div class="org-ceo">
              <span>CEO / 创始人</span>
              <strong>林一页 · 一页纸的“一页”</strong>
            </div>
            <div class="org-depts">
              ${D.DEPARTMENTS.map(
                (dept) => `
                <div class="org-node">
                  <b>${escapeHTML(dept.name)}</b>
                  <span>${escapeHTML(dept.code)} · ${escapeHTML(dept.lead)}</span>
                  <small>${escapeHTML(dept.leadRole)}</small>
                </div>`
              ).join("")}
            </div>
          </div>
        </div>
      </section>

      <section class="section section-tight">
        <div class="container">
          <div class="section-head" data-reveal>
            <div>
              <span class="eyebrow">Ranks / 职级不是等级</span>
              <h2>用职级描述责任，<br>不用它制造距离。</h2>
            </div>
            <div class="section-head-copy">
              <p>星巢的职级只回答一个问题：你现在能独立承担多大的责任。它不是身份，也不是资历的奖章。</p>
            </div>
          </div>
          <div class="matrix-wrap" data-reveal>
            <table class="rank-table">
              <thead>
                <tr><th>职级</th><th>代号</th><th>意味着什么</th><th>重点</th></tr>
              </thead>
              <tbody>
                ${D.RANKS.map(
                  (rank) => `
                  <tr>
                    <td class="rank-name">${escapeHTML(rank.name)}</td>
                    <td><span class="rank-code">${escapeHTML(rank.code)}</span></td>
                    <td>${escapeHTML(rank.line)}</td>
                    <td class="rank-focus">${escapeHTML(rank.focus)}</td>
                  </tr>`
                ).join("")}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section class="section">
        <div class="container">
          <div class="section-head" data-reveal>
            <div>
              <span class="eyebrow">Charter / 协作公约</span>
              <h2>六条约定，<br>保护时间与边界。</h2>
            </div>
            <div class="section-head-copy">
              <p>公约不是墙上的标语。它决定了会议怎么开、错误怎么说、疲惫能不能被看见。</p>
            </div>
          </div>
          <div class="charter-grid" data-reveal>
            ${D.CHARTER.map(
              (item) => `
              <article class="charter-item">
                <span class="charter-no">${escapeHTML(item.no)}</span>
                <div>
                  <h3>${escapeHTML(item.title)}</h3>
                  <p>${escapeHTML(item.text)}</p>
                </div>
              </article>`
            ).join("")}
          </div>
        </div>
      </section>

      <section class="section section-tight" style="background: var(--paper-deep); border-block: 1px solid var(--line-strong);">
        <div class="container">
          <div class="section-head-row" data-reveal>
            <div>
              <span class="eyebrow">Benefits / 你能带走什么</span>
              <h2>没有零食柜，<br>但有这几样东西。</h2>
            </div>
          </div>
          <div class="benefit-grid">
            ${D.BENEFITS.map(
              (benefit) => `
              <article class="benefit-card" data-reveal>
                <span class="benefit-icon" aria-hidden="true">${icon(benefit.icon)}</span>
                <h3>${escapeHTML(benefit.title)}</h3>
                <p>${escapeHTML(benefit.text)}</p>
              </article>`
            ).join("")}
          </div>
        </div>
      </section>

      <section class="section">
        <div class="container">
          <div class="section-head" data-reveal>
            <div>
              <span class="eyebrow">FAQ / 先把边界说清楚</span>
              <h2>你可能想问的<br>几个问题。</h2>
            </div>
            <div class="section-head-copy">
              <p>如果这里没有回答你的问题，记住一条：星巢不收费，也不收集你的敏感信息。</p>
            </div>
          </div>
          <div class="faq-list" data-reveal>
            ${D.FAQ.map(
              (item) => `
              <details class="faq-item">
                <summary>${escapeHTML(item.q)}</summary>
                <div class="faq-answer">${escapeHTML(item.a)}</div>
              </details>`
            ).join("")}
          </div>
        </div>
      </section>

      <section class="final-cta">
        <div class="container final-cta-inner">
          <span class="eyebrow">No perfect resume required</span>
          <h2 style="margin-top: 20px;">
            <span>你不需要先变厉害，</span>
            <span>才<em>值得</em>一个开始。</span>
          </h2>
          <div class="final-cta-bottom">
            <p>带一个真实的自己来就好。剩下的，我们在第一周一起拆。</p>
            <a class="btn btn-primary btn-lg" href="#/join">开始线上入职 <span class="btn-arrow" aria-hidden="true">↗</span></a>
          </div>
        </div>
      </section>
    `;
  }

  /* ---------------- 巢盾安全页 ---------------- */

  function securityMarkup() {
    return `
      <section class="security-hero">
        <div class="container">
          <div class="security-hero-grid">
            <div>
              <span class="eyebrow">NEST SHIELD / 巢盾安全中心</span>
              <h1>把安全，<br>做成<em>默认设置</em>。</h1>
              <p class="security-hero-copy">
                容量无限，意味着入口必须更稳。巢盾是星巢的安全与隐私子品牌：用最小收集、最少依赖和可验证的边界，保护每一位住户的本地数据。
              </p>
              <div class="status-pills">
                <span class="pill">本站已落地 8 项</span>
                <span class="pill">零第三方依赖</span>
                <span class="pill">数据仅存本地</span>
                <span class="pill">可导出 / 可删除</span>
              </div>
            </div>
            <div class="shield-graphic" aria-hidden="true">
              <div class="shield-ring shield-ring-two"></div>
              <div class="shield-ring shield-ring-one"></div>
              <div class="shield-core">
                ${icon("shield")}
                <span>NEST SHIELD / ONLINE</span>
              </div>
              <span class="shield-label l1">CSP</span>
              <span class="shield-label l2">nosniff</span>
              <span class="shield-label l3">SAMEORIGIN</span>
              <span class="shield-label l4">no-referrer</span>
            </div>
          </div>
        </div>
      </section>

      <section class="section">
        <div class="container">
          <div class="section-head" data-reveal>
            <div>
              <span class="eyebrow">Protections / 六条安全基线</span>
              <h2>不是“请注意安全”，<br>是“已经这样做了”。</h2>
            </div>
            <div class="section-head-copy">
              <p>下面六项是本站的设计与实现原则。我们明确区分“已经落地的演示”与“生产环境才需要的蓝图”，不把蓝图说成现状。</p>
            </div>
          </div>
          <div class="protection-grid">
            ${D.SECURITY_PROTECTIONS.map(
              (item) => `
              <article class="protection-card" data-reveal>
                <span class="protection-code">${escapeHTML(item.code)}</span>
                <h3>${escapeHTML(item.title)}</h3>
                <p>${escapeHTML(item.text)}</p>
              </article>`
            ).join("")}
          </div>
        </div>
      </section>

      <section class="section section-tight" style="background: var(--paper-deep); border-block: 1px solid var(--line-strong);">
        <div class="container">
          <div class="section-head" data-reveal>
            <div>
              <span class="eyebrow">Reality check / 现状与蓝图</span>
              <h2>哪些已经做了，<br>哪些还没有。</h2>
            </div>
            <div class="section-head-copy">
              <p>一个诚实的安全页面，应该告诉你边界在哪里。本站是纯前端概念演示，没有真实的账号、服务端数据库或企业级监控。</p>
            </div>
          </div>
          <div class="security-columns" data-reveal>
            <div class="security-column">
              <h3>本站已经落地</h3>
              <p>你可以在当前页面直接验证这些行为。</p>
              <ul class="security-check-list">
                ${D.IMPLEMENTED.map((item) => "<li>" + escapeHTML(item) + "</li>").join("")}
              </ul>
            </div>
            <div class="security-column is-dark">
              <h3>生产环境蓝图</h3>
              <p>这些能力需要真实后端、身份系统与运维体系，本站没有假装启用。</p>
              <ul class="security-check-list">
                ${D.PRODUCTION_PLAN.map((item) => "<li>" + escapeHTML(item) + "</li>").join("")}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section class="section">
        <div class="container">
          <div class="section-head" data-reveal>
            <div>
              <span class="eyebrow">Architecture / 数据怎么流动</span>
              <h2>一条请求，<br>经过四道边界。</h2>
            </div>
            <div class="section-head-copy">
              <p>从浏览器到本地存储，每一层都只拿到完成当前任务所需的最少信息。演示版本没有服务端业务数据。</p>
            </div>
          </div>
          <div class="architecture" data-reveal>
            <h3>STARNEST / REQUEST BOUNDARY</h3>
            <p>当前演示为静态页面 + 本地存储；安全响应头由本地 Python 预览服务器下发。</p>
            <div class="arch-flow">
              <div class="arch-layer">
                <span class="arch-label">EDGE / 边界</span>
                <div class="arch-items"><span>CSP</span><span>X-Frame-Options</span><span>nosniff</span><span>Referrer-Policy</span><span>Rate limit</span></div>
              </div>
              <div class="arch-layer">
                <span class="arch-label">INPUT / 输入</span>
                <div class="arch-items"><span>字段白名单</span><span>长度限制</span><span>必填校验</span><span>不收集敏感信息</span></div>
              </div>
              <div class="arch-layer">
                <span class="arch-label">RENDER / 渲染</span>
                <div class="arch-items"><span>HTML 转义</span><span>textContent</span><span>无内联事件</span><span>无第三方脚本</span></div>
              </div>
              <div class="arch-layer">
                <span class="arch-label">STORE / 存储</span>
                <div class="arch-items"><span>localStorage</span><span>读取时再校验</span><span>导出 JSON</span><span>一键删除</span></div>
              </div>
            </div>
          </div>

          <div class="section-head" style="margin-top: 64px;" data-reveal>
            <div>
              <span class="eyebrow">Threat model / 轻量威胁建模</span>
              <h2>先假设会出错，<br>再决定怎么防。</h2>
            </div>
          </div>
          <div class="protection-grid">
            ${D.THREAT_MODEL.map(
              (item, index) => `
              <article class="protection-card" data-reveal>
                <span class="protection-code">T-${String(index + 1).padStart(2, "0")}</span>
                <h3>${escapeHTML(item.title)}</h3>
                <p><strong>风险：</strong>${escapeHTML(item.risk)}<br><strong>控制：</strong>${escapeHTML(item.control)}</p>
              </article>`
            ).join("")}
          </div>
        </div>
      </section>

      <section class="section section-tight">
        <div class="container">
          <div class="section-head" data-reveal>
            <div>
              <span class="eyebrow">Access matrix / 最小权限</span>
              <h2>能看见什么，<br>由角色决定。</h2>
            </div>
            <div class="section-head-copy">
              <p>前端隐藏不是授权。生产环境必须在服务端逐请求校验；这里的矩阵用于说明权限设计，不是可绕过的真实鉴权。</p>
            </div>
          </div>
          <div class="matrix-wrap" data-reveal>
            <table class="permission-table">
              <thead>
                <tr>
                  <th>角色 / 资源</th>
                  ${D.PERMISSION_MATRIX.columns.map((col) => "<th>" + escapeHTML(col) + "</th>").join("")}
                </tr>
              </thead>
              <tbody>
                ${D.PERMISSION_MATRIX.rows
                  .map(
                    (row, index) => `
                  <tr>
                    <td>${escapeHTML(D.PERMISSION_MATRIX.roles[index] || "")}</td>
                    ${row.map((cell) => "<td>" + escapeHTML(cell) + "</td>").join("")}
                  </tr>`
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
          <p class="matrix-note">注：访客没有个人工位；新住户只能访问本人数据；部门负责人可查看本部门摘要；安全管理员的高危操作需要双人审批。</p>
        </div>
      </section>

      <section class="section" style="background: var(--paper-deep); border-block: 1px solid var(--line-strong);">
        <div class="container">
          <div class="section-head" data-reveal>
            <div>
              <span class="eyebrow">Drill & audit / 演练与审计</span>
              <h2>先练一次，<br>再相信自己的直觉。</h2>
            </div>
            <div class="section-head-copy">
              <p>5 道真实场景题，测试你的安全直觉。你的本地操作也会留下最多 60 条审计记录，可随时清空。</p>
            </div>
          </div>
          <div class="security-columns">
            <section class="quiz-panel" id="quiz-panel" aria-labelledby="quiz-title">
              <div class="quiz-head">
                <div>
                  <h3 id="quiz-title">安全演练 · 5 题</h3>
                  <p>单选。答错也没关系，这里本来就是练习。</p>
                </div>
                <span class="quiz-progress">${state.quiz.submitted ? "已完成" : state.quiz.index + 1 + " / " + D.SECURITY_QUIZ.length}</span>
              </div>
              <div id="quiz-content">${quizContentMarkup()}</div>
            </section>
            <div id="audit-panel-content">${auditPanelMarkup()}</div>
          </div>
          <div class="data-rights" style="margin-top: 18px;" data-reveal>
            <div>
              <h3>你的数据，你说了算。</h3>
              <p>本站只收集入职所需的最少字段，默认只保存在当前浏览器。你可以随时导出 JSON，或一键删除全部本地记录。删除后无法恢复。</p>
            </div>
            <div class="data-rights-actions">
              ${
                state.resident
                  ? '<button class="btn btn-primary" type="button" data-action="export-data">导出我的数据</button><button class="btn btn-ghost" type="button" data-action="delete-data">删除全部数据</button>'
                  : '<a class="btn btn-primary" href="#/join">先入职，再管理数据</a>'
              }
            </div>
          </div>
          <p class="security-boundary" style="margin-top: 18px;">
            <strong>边界声明：</strong>本站是虚构概念公司与纯前端交互演示，没有真实账号体系、服务端数据库或企业级安全运营。所有“审计日志”均保存在你的浏览器 localStorage 中，仅用于展示可解释的本地记录，不构成真实合规审计。生产环境蓝图需要独立的安全评审、渗透测试与合规评估。
          </p>
        </div>
      </section>
    `;
  }

  /* ---------------- 安全演练 ---------------- */

  function quizContentMarkup() {
    const quiz = state.quiz;
    const total = D.SECURITY_QUIZ.length;

    if (quiz.submitted) {
      const score = quiz.answers.reduce((sum, answer, index) => {
        return sum + (answer === D.SECURITY_QUIZ[index].answer ? 1 : 0);
      }, 0);
      const resultText =
        score === total
          ? "满分的直觉。你大概率能识别大多数校园钓鱼与社工场景。"
          : score >= 4
          ? "很稳。再补上最后一个细节，你就能把风险挡在点击之前。"
          : score >= 3
          ? "基础不错，但还有几个容易踩中的坑。建议把解析读一遍。"
          : "别灰心，这些场景本来就是设计来骗过直觉的。读完解析，再练一次。";

      return `
        <div class="quiz-result">
          <div class="quiz-score">
            <strong>${score}</strong>
            <span>/ ${total} 正确</span>
          </div>
          <p class="quiz-result-text">${resultText}</p>
          <div class="quiz-review">
            ${D.SECURITY_QUIZ.map((item, index) => {
              const correct = quiz.answers[index] === item.answer;
              return `
                <div class="quiz-review-item ${correct ? "is-correct" : "is-wrong"}">
                  <b>${correct ? "✓" : "×"} 第 ${index + 1} 题 · 你的选择：${
                quiz.answers[index] == null ? "未作答" : escapeHTML(item.options[quiz.answers[index]])
              }</b>
                  <span>${escapeHTML(item.explain)}</span>
                </div>`;
            }).join("")}
          </div>
          <div class="quiz-actions">
            <button class="btn btn-primary" type="button" data-action="quiz-retry">再练一次</button>
            <a class="btn btn-ghost" href="#/join">去领一张工牌 <span class="btn-arrow" aria-hidden="true">↗</span></a>
          </div>
        </div>
      `;
    }

    const question = D.SECURITY_QUIZ[quiz.index];
    const selected = quiz.answers[quiz.index];
    return `
      <div class="quiz-question" id="quiz-question" tabindex="-1">${escapeHTML(question.q)}</div>
      <div class="quiz-options">
        ${question.options
          .map(
            (option, index) => `
          <label class="quiz-option">
            <input type="radio" name="quiz" value="${index}" ${selected === index ? "checked" : ""}>
            <span class="quiz-letter">${String.fromCharCode(65 + index)}</span>
            <span>${escapeHTML(option)}</span>
          </label>`
          )
          .join("")}
      </div>
      <div class="quiz-actions">
        <span class="mono" style="font-size:8.5px;letter-spacing:.06em;color:var(--muted);">单选 · 不记名 · 本地完成</span>
        <button class="btn btn-primary btn-sm" type="button" data-action="quiz-next">
          ${quiz.index === total - 1 ? "提交答案" : "下一题"}
          <span class="btn-arrow" aria-hidden="true">→</span>
        </button>
      </div>
    `;
  }

  function refreshQuiz() {
    const container = document.getElementById("quiz-content");
    const panel = document.getElementById("quiz-panel");
    if (container) {
      container.innerHTML = quizContentMarkup();
    }
    if (panel) {
      const progress = panel.querySelector(".quiz-progress");
      if (progress) {
        progress.textContent = state.quiz.submitted
          ? "已完成"
          : state.quiz.index + 1 + " / " + D.SECURITY_QUIZ.length;
      }
    }
    const heading = document.getElementById("quiz-question");
    if (heading) {
      heading.focus({ preventScroll: false });
    }
  }

  function nextQuiz() {
    const quiz = state.quiz;
    if (quiz.submitted) {
      return;
    }
    const selected = document.querySelector('input[name="quiz"]:checked');
    if (!selected) {
      toast("先选一个最接近你第一反应的答案。");
      return;
    }
    quiz.answers[quiz.index] = Number(selected.value);
    if (quiz.index < D.SECURITY_QUIZ.length - 1) {
      quiz.index += 1;
      refreshQuiz();
      return;
    }
    quiz.submitted = true;
    const score = quiz.answers.reduce(
      (sum, answer, index) => sum + (answer === D.SECURITY_QUIZ[index].answer ? 1 : 0),
      0
    );
    addAudit("完成安全演练，得分 " + score + "/" + D.SECURITY_QUIZ.length);
    refreshQuiz();
    refreshAuditPanel();
  }

  function retryQuiz() {
    state.quiz = {
      index: 0,
      answers: new Array(D.SECURITY_QUIZ.length).fill(null),
      submitted: false
    };
    refreshQuiz();
    refreshAuditPanel();
  }

  /* ---------------- 本地审计 ---------------- */

  function auditPanelMarkup() {
    return `
      <section class="audit-panel" aria-labelledby="audit-title">
        <div class="audit-head">
          <h3 id="audit-title">本地审计 · 最近 60 条</h3>
          ${
            state.audit.length
              ? '<button class="task-action" type="button" data-action="audit-clear">清空</button>'
              : '<span>LOCAL ONLY</span>'
          }
        </div>
        <div class="audit-list">
          ${
            state.audit.length
              ? state.audit
                  .map(
                    (entry) => `
                <div class="audit-entry">
                  <span class="audit-time">${formatAuditTime(entry.at)}</span>
                  <span class="audit-action">${escapeHTML(entry.action)}</span>
                  <span class="audit-actor">${escapeHTML(entry.actor)}</span>
                </div>`
                  )
                  .join("")
              : '<div class="audit-empty">还没有本地操作记录。<br>入职、勾选清单、导出或删除数据时，会在这里留下记录。</div>'
          }
        </div>
      </section>
    `;
  }

  function refreshAuditPanel() {
    const container = document.getElementById("audit-panel-content");
    if (container) {
      container.innerHTML = auditPanelMarkup();
    }
  }

  /* ---------------- 岗位罗盘 ---------------- */

  function openCompass() {
    state.compass = { index: 0, scores: {}, done: false };
    openDialog(compassMarkup(), document.activeElement);
  }

  function compassMarkup() {
    const compass = state.compass;
    let body = "";

    if (compass.done) {
      const ranked = Object.entries(compass.scores).sort((a, b) => b[1] - a[1]);
      const topId = ranked.length ? ranked[0][0] : "strategy";
      const dept = getDept(topId) || D.DEPARTMENTS[0];
      const roles = D.ROLES.filter((role) => role.deptId === dept.id).slice(0, 2);
      body = `
        <div class="compass-result">
          <span class="compass-result-label">Your direction / 你的第一落点</span>
          <h3>${escapeHTML(dept.name)}</h3>
          <p>${escapeHTML(dept.mission)}</p>
          <div class="compass-roles">
            ${roles
              .map(
                (role) => `
              <button class="compass-role" type="button" data-action="compass-apply" data-role-id="${escapeHTML(role.id)}">
                <span>${escapeHTML(role.title)} · ${escapeHTML(role.level)}</span>
                <span aria-hidden="true">↗</span>
              </button>`
              )
              .join("")}
          </div>
        </div>
        <p class="security-boundary" style="margin-top: 16px;">罗盘只是一个起点，不是结论。你可以随时换方向，内部转岗不设次数。</p>
        <div class="compass-actions">
          <button class="btn btn-ghost" type="button" data-action="compass-restart">重新测一次</button>
          <a class="btn btn-primary" href="#/careers" data-action="close-dialog">看全部岗位 <span class="btn-arrow" aria-hidden="true">↗</span></a>
        </div>
      `;
    } else {
      const question = D.COMPASS_QUESTIONS[compass.index];
      body = `
        <div class="compass-progress" aria-hidden="true">
          ${D.COMPASS_QUESTIONS.map(
            (_, index) =>
              `<i class="${index <= compass.index ? "is-on" : ""}"></i>`
          ).join("")}
        </div>
        <p class="compass-question">${escapeHTML(question.q)}</p>
        <p class="compass-hint">${escapeHTML(question.hint)}</p>
        <div class="compass-options">
          ${question.options
            .map(
              (option, index) => `
            <button class="compass-option" type="button" data-action="compass-option" data-index="${index}">
              <span>
                <b>${escapeHTML(option.label)}</b>
                <small>${escapeHTML(option.detail)}</small>
              </span>
              <span aria-hidden="true">→</span>
            </button>`
            )
            .join("")}
        </div>
        <div class="compass-actions">
          <span class="mono" style="font-size:8.5px;letter-spacing:.08em;color:var(--muted);">第 ${compass.index + 1} / ${D.COMPASS_QUESTIONS.length} 题</span>
          <button class="text-link" type="button" data-action="close-dialog" style="background:none;border-top:0;border-left:0;border-right:0;padding:0 0 2px;">先不测了</button>
        </div>
      `;
    }

    return `
      <div class="compass-dialog">
        <div class="dialog-kicker">POSITION COMPASS / 岗位罗盘</div>
        <h2 id="dialog-title" tabindex="-1">${compass.done ? "你可能会在这里发光。" : "用 3 个问题，找到一个起点。"}</h2>
        ${body}
      </div>
    `;
  }

  function chooseCompass(index) {
    const question = D.COMPASS_QUESTIONS[state.compass.index];
    const option = question ? question.options[index] : null;
    if (!option) {
      return;
    }
    Object.keys(option.weights).forEach((deptId) => {
      if (!getDept(deptId)) {
        return;
      }
      state.compass.scores[deptId] = (state.compass.scores[deptId] || 0) + option.weights[deptId];
    });
    if (state.compass.index < D.COMPASS_QUESTIONS.length - 1) {
      state.compass.index += 1;
    } else {
      state.compass.done = true;
    }
    const content = document.getElementById("dialog-content");
    if (content) {
      content.innerHTML = compassMarkup();
      const dialog = document.getElementById("site-dialog");
      const shell = dialog ? dialog.querySelector(".dialog-shell") : null;
      if (shell) {
        shell.scrollTop = 0;
      }
      const heading = document.getElementById("dialog-title");
      if (heading) {
        heading.focus();
      }
    }
  }

  /* ---------------- 入职向导 ---------------- */

  function joinMarkup() {
    const draft = state.draft;
    return `
      <section class="page-hero">
        <div class="container">
          <div class="page-hero-grid">
            <div>
              <span class="eyebrow">Onboarding / 线上入职 · 无需等待</span>
              <h1>先落座，<br>再<em>发光</em>。</h1>
              <p class="page-hero-copy">
                5 分钟，5 个步骤。没有笔试，没有群面，也没有“回去等通知”。填完最后一页，你会立刻拿到工号、数字工牌和第一周清单。
              </p>
            </div>
            <aside class="page-hero-aside">
              <strong>∞</strong>
              <span>SEATS / 无需排队</span>
              <p>岗位不设名额。为带教质量，新住户会分批分组，但不会被淘汰。</p>
            </aside>
          </div>
        </div>
      </section>

      <section class="join-page">
        <div class="container">
          <div class="join-layout">
            <div class="join-main">
              ${
                state.resident
                  ? `
                <div class="existing-banner">
                  <div>
                    <b>你已经有一个工位：${escapeHTML(state.resident.name)}</b>
                    <span>工号 ${escapeHTML(state.resident.id)} · ${escapeHTML(
                        (getRole(state.resident.roleId) || {}).title || ""
                      )}。重新提交会覆盖当前工位记录。</span>
                  </div>
                  <a class="btn btn-sm btn-primary" href="#/workspace">进入工位</a>
                </div>`
                  : ""
              }

              <div class="wizard-card">
                <div class="wizard-progress" aria-label="入职进度">
                  ${STEP_LABELS.map(
                    (label, index) => `
                    <div class="wizard-progress-step ${
                      index < draft.step ? "is-done" : index === draft.step ? "is-active" : ""
                    }">
                      <span class="wizard-progress-dot">${index < draft.step ? "✓" : String(index + 1).padStart(2, "0")}</span>
                      <span class="wizard-progress-label">${label}</span>
                    </div>`
                  ).join("")}
                </div>

                <form id="join-form" novalidate autocomplete="off">
                  ${wizardStepMarkup(draft.step)}
                  <div class="wizard-actions">
                    ${
                      draft.step > 0
                        ? '<button class="btn btn-ghost" type="button" data-action="wizard-back">上一步</button>'
                        : '<span class="mono" style="font-size:8.5px;color:var(--muted);">大约 5 分钟</span>'
                    }
                    <button class="btn btn-primary wizard-actions-right" type="button" data-action="wizard-next">
                      ${draft.step === 3 ? "确认入职，领取工牌" : "继续：" + STEP_LABELS[draft.step + 1]}
                      <span class="btn-arrow" aria-hidden="true">→</span>
                    </button>
                  </div>
                </form>
              </div>
            </div>

            <aside class="join-aside">
              <div class="aside-card">
                <h2>无限席位，<br>但不是无人值守。</h2>
                <p>每位新住户会匹配一位部门伙伴。前两周至少两次 1:1，第一周只认领一个小任务。</p>
                <div class="aside-list">
                  <div><span>部门</span><b>8 个</b></div>
                  <div><span>开放岗位</span><b>${D.ROLES.length} 个</b></div>
                  <div><span>参与费用</span><b>0 元</b></div>
                  <div><span>实践周期</span><b>8 周 · 可暂停</b></div>
                </div>
              </div>
              <div class="aside-info">
                <strong>只收最少的信息</strong>
                不收集手机号、身份证号、银行卡、密码或定位。所有内容默认只保存在你的浏览器本地，可随时导出或删除。
              </div>
              <div class="aside-info">
                <strong>这不是真实雇佣</strong>
                星巢是虚构概念公司与交互演示。没有工资，不构成劳动关系；完成实践后可申请带编号的项目证明。
              </div>
            </aside>
          </div>
        </div>
      </section>
    `;
  }

  function wizardStepMarkup(step) {
    if (step === 0) {
      return `
        <div class="wizard-step-head">
          <span class="eyebrow">Step 01 / 认识你</span>
          <h2>${STEP_TITLES[0]}</h2>
          <p>不用真名，昵称也可以。我们只需要知道怎么称呼你，以及你现在大概在哪个阶段。</p>
        </div>
        <div class="form-grid">
          <div class="field">
            <label for="join-name">怎么称呼你 <span class="optional">必填 · 2–20 字</span></label>
            <input id="join-name" data-field="name" name="name" type="text" maxlength="20" value="${escapeHTML(
              state.draft.form.name
            )}" placeholder="例如：林一页 / 小满" aria-invalid="${state.joinErrors.name ? "true" : "false"}" ${
        state.joinErrors.name ? 'aria-describedby="err-name"' : ""
      }>
            ${fieldErrorMarkup("name")}
            <span class="field-hint">它会出现在你的数字工牌上。</span>
          </div>
          <div class="field">
            <label for="join-school">学校 / 机构 <span class="optional">必填</span></label>
            <input id="join-school" data-field="school" name="school" type="text" maxlength="40" value="${escapeHTML(
              state.draft.form.school
            )}" placeholder="例如：南山大学 / 自学" aria-invalid="${state.joinErrors.school ? "true" : "false"}" ${
        state.joinErrors.school ? 'aria-describedby="err-school"' : ""
      }>
            ${fieldErrorMarkup("school")}
          </div>
          <div class="field">
            <label for="join-major">专业 / 方向 <span class="optional">必填</span></label>
            <input id="join-major" data-field="major" name="major" type="text" maxlength="30" value="${escapeHTML(
              state.draft.form.major
            )}" placeholder="例如：计算机 / 中文 / 还没定" aria-invalid="${state.joinErrors.major ? "true" : "false"}" ${
        state.joinErrors.major ? 'aria-describedby="err-major"' : ""
      }>
            ${fieldErrorMarkup("major")}
          </div>
          <div class="field">
            <label for="join-grade">当前阶段 <span class="optional">必填</span></label>
            <select id="join-grade" data-field="grade" name="grade" aria-invalid="${
              state.joinErrors.grade ? "true" : "false"
            }" ${state.joinErrors.grade ? 'aria-describedby="err-grade"' : ""}>
              ${D.GRADES.map(
                (grade) =>
                  `<option value="${escapeHTML(grade)}" ${
                    state.draft.form.grade === grade ? "selected" : ""
                  }>${escapeHTML(grade)}</option>`
              ).join("")}
            </select>
            ${fieldErrorMarkup("grade")}
          </div>
        </div>
        <p class="field-hint" style="margin-top: 18px;">继续即表示你愿意在本机创建一份入职记录。你随时可以在“我的工位”里删除它。</p>
      `;
    }

    if (step === 1) {
      const role = getRole(state.draft.roleId);
      return `
        <div class="wizard-step-head">
          <span class="eyebrow">Step 02 / 选航线</span>
          <h2>${STEP_TITLES[1]}</h2>
          <p>不用选“最适合一辈子”的岗位。选一个你现在愿意花 8 周试一试的方向。</p>
        </div>
        <div class="field">
          <div class="field-label-row">
            <label for="join-role">意向岗位 <span class="optional">必填</span></label>
            <button class="text-link" type="button" data-action="open-compass" style="background:none;border-top:0;border-left:0;border-right:0;padding:0 0 2px;font-size:10.5px;">不确定？打开岗位罗盘</button>
          </div>
          <select id="join-role" data-field="roleId" name="roleId" aria-invalid="${
            state.joinErrors.roleId ? "true" : "false"
          }" ${state.joinErrors.roleId ? 'aria-describedby="err-roleId"' : ""}>
            <option value="">选择一个你想先试的方向</option>
            ${D.DEPARTMENTS.map(
              (dept) => `
              <optgroup label="${escapeHTML(dept.name)}">
                ${D.ROLES.filter((item) => item.deptId === dept.id)
                  .map(
                    (item) =>
                      `<option value="${escapeHTML(item.id)}" ${
                        state.draft.roleId === item.id ? "selected" : ""
                      }>${escapeHTML(item.title)} · ${escapeHTML(item.level)}</option>`
                  )
                  .join("")}
              </optgroup>`
            ).join("")}
          </select>
          ${fieldErrorMarkup("roleId")}
        </div>
        <div class="role-select-preview" id="role-preview">${rolePreviewMarkup(role)}</div>

        <div class="field" style="margin-top: 22px;">
          <div class="field-label-row">
            <label>你愿意带来的能力 <span class="optional">选 1–3 个</span></label>
            <span class="char-count" id="skill-count">${state.draft.skills.length} / 3</span>
          </div>
          <div class="chip-picker" id="skill-picker">${skillPickerMarkup()}</div>
          ${fieldErrorMarkup("skills")}
          <span class="field-hint">不会也没关系。选你愿意练的，而不是已经精通的。</span>
        </div>

        <div class="field" style="margin-top: 22px;">
          <div class="field-label-row">
            <label for="join-motivation">你想解决的一个小问题 <span class="optional">必填 · 10–200 字</span></label>
            <span class="char-count" id="motivation-count">${state.draft.motivation.length} / 200</span>
          </div>
          <textarea id="join-motivation" data-field="motivation" name="motivation" maxlength="200" rows="4" placeholder="例如：我想做一个让新生不用在群里反复问“这个专业能做什么”的页面。">${escapeHTML(
            state.draft.motivation
          )}</textarea>
          ${fieldErrorMarkup("motivation")}
        </div>
      `;
    }

    if (step === 2) {
      return `
        <div class="wizard-step-head">
          <span class="eyebrow">Step 03 / 工作方式</span>
          <h2>${STEP_TITLES[2]}</h2>
          <p>按你的真实情况选。我们不需要你“看起来很有空”，只需要你说实话。</p>
        </div>
        <div class="form-grid">
          <div class="field">
            <label for="join-hours">每周可投入 <span class="optional">必填</span></label>
            <select id="join-hours" data-field="hours" name="hours">
              ${D.HOURS.map(
                (hours) =>
                  `<option value="${escapeHTML(hours)}" ${
                    state.draft.form.hours === hours ? "selected" : ""
                  }>${escapeHTML(hours)}</option>`
              ).join("")}
            </select>
          </div>
          <div class="field">
            <label for="join-start">希望什么时候开始 <span class="optional">必填</span></label>
            <select id="join-start" data-field="start" name="start">
              ${D.START_OPTIONS.map(
                (option) =>
                  `<option value="${escapeHTML(option)}" ${
                    state.draft.form.start === option ? "selected" : ""
                  }>${escapeHTML(option)}</option>`
              ).join("")}
            </select>
          </div>
        </div>

        <div class="field" style="margin-top: 22px;">
          <label>你更喜欢哪种工作节奏 <span class="optional">必填</span></label>
          <div class="choice-grid choice-grid-three">
            ${D.WORK_STYLES.map(
              (style, index) => `
              <label class="choice-card">
                <input type="radio" name="workStyle" data-field="workStyle" value="${escapeHTML(style)}" ${
                state.draft.form.workStyle === style ? "checked" : ""
              }>
                <span class="choice-radio" aria-hidden="true"></span>
                <span class="choice-text">${escapeHTML(style)}<small>${
                index === 0
                  ? "给我整块时间，把一件事做透"
                  : index === 1
                  ? "在讨论和反馈里快速推进"
                  : "任务切换多，按优先级灵活安排"
              }</small></span>
              </label>`
            ).join("")}
          </div>
        </div>

        <div class="dialog-callout" style="margin-top: 24px;">
          <span>Practice commitment / 实践承诺</span>
          <p>${escapeHTML(D.PRACTICE_COMMITMENT)}。考试周、项目冲突或状态不好时，可以申请暂停，不需要编一个完美的理由。</p>
        </div>
      `;
    }

    const role = getRole(state.draft.roleId);
    const dept = roleDept(role);
    const skills = state.draft.skills.join("、") || "未选择";
    return `
      <div class="wizard-step-head">
        <span class="eyebrow">Step 04 / 确认承诺</span>
        <h2>${STEP_TITLES[3]}</h2>
        <p>最后一步。确认信息、阅读边界，然后领取只属于你的工牌。</p>
      </div>

      <div class="review-box">
        ${reviewRowMarkup("称呼", state.draft.form.name)}
        ${reviewRowMarkup("学校 / 机构", state.draft.form.school)}
        ${reviewRowMarkup("专业 / 方向", state.draft.form.major)}
        ${reviewRowMarkup("当前阶段", state.draft.form.grade)}
        ${reviewRowMarkup("意向岗位", role ? role.title + " · " + (dept ? dept.name : "") : "未选择")}
        ${reviewRowMarkup("行业导师", dept ? dept.lead + " / " + dept.leadRole : "—")}
        ${reviewRowMarkup("每周投入", state.draft.form.hours)}
        ${reviewRowMarkup("开始时间", state.draft.form.start)}
        ${reviewRowMarkup("工作节奏", state.draft.form.workStyle)}
        ${reviewRowMarkup("愿意带来的能力", skills)}
      </div>

      <div class="field">
        <label>三项承诺 <span class="optional">全部必选</span></label>
        <div class="consent-list">
          ${consentMarkup(
            "practice",
            "我理解星巢是虚构概念公司与交互演示，不构成真实劳动关系、招聘承诺或薪酬承诺。"
          )}
          ${consentMarkup(
            "privacy",
            "我同意上述信息仅保存在本浏览器本地，并理解我可以随时导出或删除全部数据。"
          )}
          ${consentMarkup(
            "honesty",
            "我承诺不提交他人的隐私或敏感信息，并在任何协作中遵守授权与边界。"
          )}
        </div>
        ${state.joinErrors.consents ? '<p class="field-error" style="margin-top:8px;">' + escapeHTML(state.joinErrors.consents) + "</p>" : ""}
      </div>

      <p class="field-hint" style="margin-top: 18px;">
        点击“确认入职”后，你的工号、数字工牌和第一周清单会立即生成。没有服务端提交，也没有等待审核。
      </p>
    `;
  }

  function fieldErrorMarkup(field) {
    const message = state.joinErrors[field];
    if (!message) {
      return "";
    }
    return '<p class="field-error" id="err-' + escapeHTML(field) + '">' + escapeHTML(message) + "</p>";
  }

  function reviewRowMarkup(label, value) {
    return `<div class="review-row"><span>${escapeHTML(label)}</span><strong>${escapeHTML(
      value || "—"
    )}</strong></div>`;
  }

  function consentMarkup(key, text) {
    return `
      <label class="consent-item">
        <input type="checkbox" data-consent="${escapeHTML(key)}" ${
      state.draft.consents[key] ? "checked" : ""
    }>
        <span class="consent-box" aria-hidden="true">
          <svg viewBox="0 0 24 24">${D.ICON_PATHS.check}</svg>
        </span>
        <span class="consent-text">${escapeHTML(text)}</span>
      </label>
    `;
  }

  function rolePreviewMarkup(role) {
    if (!role) {
      return `
        <div class="selector-hint"><span>岗位预览</span><span>选择后显示导师与第一个任务</span></div>
        <div class="aside-info">
          <strong>还不确定？</strong>
          用 3 个问题找到你的第一落点。罗盘不替你做决定，只帮你排除一个明显不合适的方向。
          <button class="text-link" type="button" data-action="open-compass" style="margin-top:8px;background:none;border-top:0;border-left:0;border-right:0;padding:0 0 2px;font-size:10.5px;">打开岗位罗盘 <span aria-hidden="true">↗</span></button>
        </div>
      `;
    }
    const dept = roleDept(role);
    return `
      <div class="selector-hint"><span>岗位预览</span><span>${escapeHTML(role.type)}</span></div>
      <div class="mini-role" style="${deptStyle(dept)}">
        <span class="mini-role-icon" aria-hidden="true">${icon(dept ? dept.icon : "spark")}</span>
        <div>
          <h3>${escapeHTML(role.title)}</h3>
          <p>${escapeHTML(dept ? dept.name : "星巢")} · 导师 ${escapeHTML(dept ? dept.lead : "待定")} · ${escapeHTML(
      role.level
    )}</p>
        </div>
        <span class="mini-role-seat"><b>∞</b>席位</span>
      </div>
      <p class="field-hint" style="margin-top: 8px;">第一个任务：${escapeHTML(role.mission)}</p>
    `;
  }

  function skillPickerMarkup() {
    const role = getRole(state.draft.roleId);
    const list = [];
    if (role) {
      role.skills.forEach((skill) => list.push(skill));
    }
    state.draft.skills.forEach((skill) => {
      if (list.indexOf(skill) === -1) {
        list.push(skill);
      }
    });
    D.SKILLS.forEach((skill) => {
      if (list.length < 10 && list.indexOf(skill) === -1) {
        list.push(skill);
      }
    });
    return list
      .slice(0, 12)
      .map(
        (skill) =>
          `<button class="skill-chip" type="button" data-action="toggle-skill" data-skill="${escapeHTML(
            skill
          )}" aria-pressed="${state.draft.skills.indexOf(skill) !== -1 ? "true" : "false"}">${escapeHTML(skill)}</button>`
      )
      .join("");
  }

  function updateRoleDependentUI() {
    const role = getRole(state.draft.roleId);
    const preview = document.getElementById("role-preview");
    if (preview) {
      preview.innerHTML = rolePreviewMarkup(role);
    }
    const picker = document.getElementById("skill-picker");
    if (picker) {
      picker.innerHTML = skillPickerMarkup();
    }
    updateSkillCount();
  }

  function updateSkillCount() {
    const count = document.getElementById("skill-count");
    if (count) {
      count.textContent = state.draft.skills.length + " / 3";
    }
  }

  function collectCurrentStep() {
    const form = document.getElementById("join-form");
    if (!form) {
      return;
    }
    form.querySelectorAll("[data-field]").forEach((element) => {
      const field = element.dataset.field;
      if (!field) {
        return;
      }
      if (element.type === "radio") {
        if (element.checked) {
          assignDraftField(field, element.value);
        }
      } else {
        assignDraftField(field, element.value);
      }
    });
    form.querySelectorAll("[data-consent]").forEach((element) => {
      state.draft.consents[element.dataset.consent] = Boolean(element.checked);
    });
    saveDraft();
  }

  function assignDraftField(field, value) {
    if (field === "roleId") {
      state.draft.roleId = getRole(value) ? value : "";
      return;
    }
    if (field === "motivation") {
      state.draft.motivation = cleanText(value, 200);
      return;
    }
    if (state.draft.form) {
      state.draft.form[field] = value;
    }
  }

  function validateIdentity() {
    const errors = {};
    const form = state.draft.form;
    const name = cleanLine(form.name, 20);
    const school = cleanLine(form.school, 40);
    const major = cleanLine(form.major, 30);
    if (name.length < 2) {
      errors.name = "写一个 2–20 字的称呼，昵称也可以。";
    }
    if (school.length < 2) {
      errors.school = "请填写学校或机构名称，至少 2 个字。";
    }
    if (major.length < 2) {
      errors.major = "请填写专业或方向，至少 2 个字。";
    }
    if (!D.GRADES.includes(form.grade)) {
      errors.grade = "请选择一个当前阶段。";
    }
    return errors;
  }

  function validateRoleChoice() {
    const errors = {};
    const role = getRole(state.draft.roleId);
    if (!role) {
      errors.roleId = "先选择一个意向岗位，之后随时可以换。";
    }
    if (!state.draft.skills.length || state.draft.skills.length > 3) {
      errors.skills = "选择 1–3 个你愿意带来的能力。";
    }
    if (cleanText(state.draft.motivation, 200).length < 10) {
      errors.motivation = "用至少 10 个字，说一个你想解决的小问题。";
    }
    return errors;
  }

  function validatePreferences() {
    const errors = {};
    const form = state.draft.form;
    if (!D.HOURS.includes(form.hours)) {
      errors.hours = "请选择每周可投入时间。";
    }
    if (!D.START_OPTIONS.includes(form.start)) {
      errors.start = "请选择希望开始的时间。";
    }
    if (!D.WORK_STYLES.includes(form.workStyle)) {
      errors.workStyle = "请选择一种更接近你的工作节奏。";
    }
    return errors;
  }

  function validateStep(step) {
    let errors = {};
    if (step === 0) {
      errors = validateIdentity();
    } else if (step === 1) {
      errors = validateRoleChoice();
    } else if (step === 2) {
      errors = validatePreferences();
    } else {
      errors = Object.assign({}, validateIdentity(), validateRoleChoice(), validatePreferences());
      const c = state.draft.consents;
      if (!c.practice || !c.privacy || !c.honesty) {
        errors.consents = "请逐项阅读并勾选全部三项承诺。";
      }
    }
    return errors;
  }

  function focusFirstError() {
    const first = document.querySelector("#join-form [aria-invalid='true'], #join-form .field-error");
    if (first) {
      if (first.matches("input, select, textarea, button")) {
        first.focus();
      } else {
        const field = first.parentElement ? first.parentElement.querySelector("input, select, textarea") : null;
        if (field) {
          field.focus();
        }
      }
    }
  }

  function stepForErrors(errors) {
    if (errors.name || errors.school || errors.major || errors.grade) {
      return 0;
    }
    if (errors.roleId || errors.skills || errors.motivation) {
      return 1;
    }
    if (errors.hours || errors.start || errors.workStyle) {
      return 2;
    }
    return 3;
  }

  function wizardNext() {
    collectCurrentStep();
    const errors = validateStep(state.draft.step);
    state.joinErrors = errors;
    if (Object.keys(errors).length) {
      state.draft.step = stepForErrors(errors);
      renderJoinInPlace();
      focusFirstError();
      toast("还有几项需要补充。", "error");
      return;
    }
    if (state.draft.step < 3) {
      state.draft.step += 1;
      state.joinErrors = {};
      saveDraft();
      renderJoinInPlace();
      const heading = document.querySelector(".wizard-step-head h2");
      if (heading) {
        heading.setAttribute("tabindex", "-1");
        heading.focus();
      }
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    createResident();
  }

  function wizardBack() {
    collectCurrentStep();
    if (state.draft.step > 0) {
      state.draft.step -= 1;
    }
    state.joinErrors = {};
    saveDraft();
    renderJoinInPlace();
    const heading = document.querySelector(".wizard-step-head h2");
    if (heading) {
      heading.setAttribute("tabindex", "-1");
      heading.focus();
    }
  }

  function renderJoinInPlace() {
    app.innerHTML = joinMarkup();
    updateChrome();
    initReveal();
  }

  function createResident() {
    const allErrors = Object.assign({}, validateIdentity(), validateRoleChoice(), validatePreferences());
    const c = state.draft.consents;
    if (!c.practice || !c.privacy || !c.honesty) {
      allErrors.consents = "请逐项阅读并勾选全部三项承诺。";
    }
    if (Object.keys(allErrors).length) {
      state.joinErrors = allErrors;
      state.draft.step = stepForErrors(allErrors);
      renderJoinInPlace();
      focusFirstError();
      toast("还有几项需要补充。", "error");
      return;
    }

    const role = getRole(state.draft.roleId);
    const checklist = {};
    CHECK_KEYS.forEach((key) => {
      checklist[key] = key === "badge";
    });
    const tasks = {};
    TASK_KEYS.forEach((key) => {
      tasks[key] = false;
    });

    state.resident = {
      version: 1,
      id: makeResidentId(),
      name: cleanLine(state.draft.form.name, 20),
      school: cleanLine(state.draft.form.school, 40),
      major: cleanLine(state.draft.form.major, 30),
      grade: state.draft.form.grade,
      hours: state.draft.form.hours,
      start: state.draft.form.start,
      workStyle: state.draft.form.workStyle,
      roleId: role.id,
      skills: state.draft.skills.slice(0, 3),
      motivation: cleanText(state.draft.motivation, 200),
      joinedAt: new Date().toISOString(),
      status: "active",
      checklist: checklist,
      tasks: tasks,
      reflections: []
    };

    saveResident();
    addAudit("完成线上入职，领取数字工牌");
    state.draft = makeDefaultDraft();
    removeStored(DRAFT_KEY);
    state.joinErrors = {};
    const toastRegion = document.getElementById("toast-region");
    if (toastRegion) {
      toastRegion.innerHTML = "";
    }
    navigate("/welcome");
  }

  /* ---------------- 欢迎 / Offer ---------------- */

  function welcomeMarkup() {
    const resident = state.resident;
    if (!resident) {
      return "";
    }
    const role = getRole(resident.roleId);
    const dept = roleDept(role);
    return `
      <section class="section" style="padding-top: 54px;">
        <div class="container" style="max-width: 900px;">
          <div class="offer-stage">
            <div class="confetti" aria-hidden="true">${confettiMarkup()}</div>
            <p class="offer-kicker">STARNEST ∞ / ONBOARDING COMPLETE</p>
            <h1 class="offer-heading" style="margin-top: 16px;">欢迎落座，<em>${escapeHTML(resident.name)}</em>。</h1>
            <p class="text-center muted" style="text-align:center;margin-top:14px;font-size:14px;">
              从这一秒开始，你有一个工位、一位导师和一个可以先开始的小任务。
            </p>

            <div class="offer-card" style="${deptStyle(dept)}">
              <div class="offer-card-top">
                <span>OFFER OF PRACTICE / 实践邀请</span>
                <span class="offer-logo">STARNEST ∞</span>
              </div>
              <div class="offer-body">
                <div class="offer-main">
                  <div>
                    <span class="offer-hello">DEAR RESIDENT / 致新住户</span>
                    <h2 class="offer-name">${escapeHTML(resident.name)}</h2>
                    <p class="offer-role">${escapeHTML(role.title)} · ${escapeHTML(dept ? dept.name : "")}</p>
                  </div>
                  <div class="offer-id">
                    <span>RESIDENT ID / 工号</span>
                    <strong>${escapeHTML(resident.id)}</strong>
                  </div>
                </div>
                <div class="offer-grid">
                  <div class="offer-cell"><span>Department</span><strong>${escapeHTML(dept ? dept.name : "—")}</strong></div>
                  <div class="offer-cell"><span>Mentor</span><strong>${escapeHTML(dept ? dept.lead : "—")}</strong></div>
                  <div class="offer-cell"><span>Rhythm</span><strong>${escapeHTML(resident.hours)}</strong></div>
                  <div class="offer-cell"><span>Start</span><strong>${escapeHTML(resident.start)}</strong></div>
                </div>
                <p class="offer-note">
                  这是一份线上共益职业实践邀请，不是劳动合同、录用通知或薪酬承诺。你的数据只保存在当前浏览器；你可以随时在“我的工位”或“巢盾安全”中导出、删除。
                </p>
              </div>
            </div>

            <div style="max-width: 390px; margin: 30px auto 0;">
              ${idCardMarkup(resident)}
            </div>

            <div class="next-steps">
              <div class="next-step"><b>NEXT 01</b><span>读一遍《星巢公约》，知道我们怎样开会、怎样说错误。</span></div>
              <div class="next-step"><b>NEXT 02</b><span>去我的工位，勾掉第一项清单，认领第一个任务。</span></div>
              <div class="next-step"><b>NEXT 03</b><span>给导师发一条消息：你是谁、想做什么、卡在哪里。</span></div>
            </div>

            <div class="offer-actions">
              <a class="btn btn-primary btn-lg" href="#/workspace">进入我的工位 <span class="btn-arrow" aria-hidden="true">↗</span></a>
              <button class="btn btn-ghost" type="button" data-action="export-data">导出入职档案</button>
              <a class="btn btn-ghost" href="#/company">读公司手册</a>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  function confettiMarkup() {
    const colors = ["#c9f24d", "#ff6b4a", "#3157ff", "#101317", "#fffdf8"];
    let html = "";
    for (let index = 0; index < 22; index += 1) {
      const left = (index * 17 + 5) % 100;
      const color = colors[index % colors.length];
      const duration = 2.8 + (index % 5) * 0.55;
      const delay = -(index % 7) * 0.6;
      const drift = ((index % 9) - 4) * 9;
      html += `<i style="left:${left}%;--c:${color};--d:${duration.toFixed(
        1
      )}s;--delay:${delay.toFixed(1)}s;--drift:${drift}px"></i>`;
    }
    return html;
  }

  function idCardMarkup(resident) {
    const role = getRole(resident.roleId);
    const dept = roleDept(role);
    return `
      <div class="id-card" style="${deptStyle(dept)}">
        <div class="id-card-inner">
          <div class="id-card-top">
            <span>STARNEST ∞ / RESIDENT PASS</span>
            <span class="id-chip" aria-hidden="true"></span>
          </div>
          <div class="id-card-main">
            <div class="id-avatar" aria-hidden="true">${escapeHTML(initials(resident.name))}</div>
            <div>
              <span class="id-label">NAME / 姓名</span>
              <strong class="id-name">${escapeHTML(resident.name)}</strong>
              <span class="id-role">${escapeHTML(role.title)} · ${escapeHTML(dept ? dept.name : "")}</span>
            </div>
          </div>
          <div class="id-card-bottom">
            <div class="id-meta">
              <span>SEAT / 工位</span>
              <strong>∞-${escapeHTML(resident.id.slice(-4))}</strong>
            </div>
            <div class="id-meta">
              <span>JOINED</span>
              <strong>${formatDate(resident.joinedAt)}</strong>
            </div>
            <div class="id-barcode" aria-hidden="true"></div>
          </div>
        </div>
      </div>
    `;
  }

  /* ---------------- 我的工位 ---------------- */

  function workspaceMarkup() {
    if (!state.resident) {
      return workspaceEmptyMarkup();
    }
    const resident = state.resident;
    const role = getRole(resident.roleId);
    const dept = roleDept(role);
    const rank = rankForLevel(role ? role.level : "初级");
    const next = nextRank(rank);
    const checked = CHECKLIST.filter((item) => resident.checklist[item.key]).length;
    const percent = Math.round((checked / CHECKLIST.length) * 100);
    const tasks = workspaceTasks(role, dept);
    const paused = resident.status === "paused";

    return `
      <section class="workspace-page">
        <div class="container">
          <div class="workspace-head">
            <div>
              <span class="eyebrow">Workspace / 我的工位 · ${escapeHTML(resident.id)}</span>
              <h1 class="workspace-greeting">${greeting()}，<em>${escapeHTML(resident.name)}</em>。</h1>
              <p class="workspace-sub">
                ${escapeHTML(role.title)} · ${escapeHTML(dept ? dept.name : "")} · 已入职 ${daysSince(
      resident.joinedAt
    )} 天
                · 导师 ${escapeHTML(dept ? dept.lead : "待定")}
                ${paused ? ' · <span class="badge badge-warn">休眠中</span>' : ' · <span class="badge badge-ok">工位在线</span>'}
              </p>
            </div>
            <div class="workspace-head-actions">
              <a class="btn btn-sm btn-ghost" href="#/careers">开放岗位</a>
              <button class="btn btn-sm btn-lime" type="button" data-action="export-data">导出档案</button>
              <a class="btn btn-sm btn-primary" href="#/security">巢盾安全</a>
            </div>
          </div>

          <div class="workspace-grid">
            <div class="workspace-main">
              <section class="panel" style="${deptStyle(dept)}">
                <div class="panel-head">
                  <h2>数字工牌</h2>
                  <button class="task-action" type="button" data-action="copy-id">复制工号</button>
                </div>
                <div style="max-width: 420px;">${idCardMarkup(resident)}</div>
                <p class="mono" style="margin-top:16px;font-size:8px;letter-spacing:.06em;color:var(--muted);line-height:1.8;">
                  LOCAL PASS · 这张工牌由你的浏览器本地生成，没有上传到任何服务器。
                </p>
              </section>

              <section class="panel">
                <div class="panel-head">
                  <h2>入职清单</h2>
                  <span class="mono">${checked} / ${CHECKLIST.length} DONE</span>
                </div>
                <div class="checklist" id="checklist">
                  ${CHECKLIST.map((item) => checkItemMarkup(item, resident)).join("")}
                </div>
                <div class="progress-line">
                  <div class="progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}">
                    <i style="--progress:${percent}%"></i>
                  </div>
                  <span id="checklist-percent">${percent}%</span>
                </div>
              </section>

              <section class="panel" style="${deptStyle(dept)}">
                <div class="panel-head">
                  <h2>本周任务</h2>
                  <span class="mono">3 SMALL STEPS</span>
                </div>
                <div class="task-list" id="task-list">
                  ${tasks.map((task) => taskItemMarkup(task, resident)).join("")}
                </div>
              </section>

              <section class="panel" style="${deptStyle(dept)}">
                <div class="panel-head">
                  <h2>部门频道 · ${escapeHTML(dept ? dept.name : "星巢")}</h2>
                  <span class="mono"># welcome</span>
                </div>
                <div class="channel">
                  <div class="channel-message">
                    <span class="channel-avatar" aria-hidden="true">${escapeHTML(initials(dept ? dept.lead : "巢"))}</span>
                    <div>
                      <div class="channel-meta"><b>${escapeHTML(dept ? dept.lead : "星巢")}</b><span>${escapeHTML(
      dept ? dept.leadRole : "带教者"
    )} · 09:12</span></div>
                      <p>${escapeHTML(resident.name)}，欢迎落座。第一周不用急着证明自己：先读完公约，认领一个小任务，然后告诉我你卡在哪里。</p>
                    </div>
                  </div>
                  <div class="channel-message">
                    <span class="channel-avatar" aria-hidden="true">∞</span>
                    <div>
                      <div class="channel-meta"><b>星巢助手</b><span>SYSTEM · 09:13</span></div>
                      <p>你的第一个岗位任务是：“${escapeHTML(role.mission)}”。它不是考试，是一块可以留下作品的小场地。</p>
                    </div>
                  </div>
                  <div class="channel-message">
                    <span class="channel-avatar" aria-hidden="true">盾</span>
                    <div>
                      <div class="channel-meta"><b>巢盾安全</b><span>SEC · 09:13</span></div>
                      <p>提醒：星巢不会索要身份证号、银行卡或验证码。任何以“补贴 / 优先选岗”为名的链接，请先当作钓鱼处理。</p>
                    </div>
                  </div>
                </div>
              </section>
            </div>

            <aside class="workspace-side">
              <section class="panel">
                <div class="panel-head">
                  <h2>安全状态</h2>
                  <span class="mono">NEST SHIELD</span>
                </div>
                <div class="security-status">
                  <div class="security-status-row"><span>数据位置</span><span class="badge badge-ok">仅本地</span></div>
                  <div class="security-status-row"><span>第三方脚本</span><span class="badge badge-ok">0 个</span></div>
                  <div class="security-status-row"><span>敏感信息</span><span class="badge badge-ok">未收集</span></div>
                  <div class="security-status-row"><span>导出 / 删除</span><span class="badge badge-ok">可用</span></div>
                  <div class="security-status-row"><span>账号体系</span><span class="badge badge-neutral">演示版无</span></div>
                </div>
                <a class="text-link" href="#/security" style="margin-top:16px;font-size:10.5px;">打开巢盾安全中心 <span aria-hidden="true">↗</span></a>
              </section>

              <section class="panel">
                <div class="panel-head"><h2>快捷操作</h2><span class="mono">QUICK</span></div>
                <div class="quick-actions">
                  <button class="quick-action" type="button" data-action="copy-id">${icon("copy")} 复制工号</button>
                  <button class="quick-action" type="button" data-action="export-data">${icon("download")} 导出档案</button>
                  <a class="quick-action" href="#/careers">${icon("compass")} 换条航线</a>
                  <a class="quick-action" href="#/company">${icon("file")} 公司手册</a>
                  <button class="quick-action" type="button" data-action="toggle-sleep">${icon("clock")} ${
      paused ? "恢复工位" : "申请休眠"
    }</button>
                  <a class="quick-action" href="#/security">${icon("shield")} 安全演练</a>
                </div>
              </section>

              <section class="panel" style="${deptStyle(dept)}">
                <div class="panel-head"><h2>成长路径</h2><span class="mono">${escapeHTML(rank.code)}</span></div>
                <div class="aside-info" style="background:var(--paper);">
                  <strong>${escapeHTML(rank.name)} · ${escapeHTML(rank.focus)}</strong>
                  ${escapeHTML(rank.line)}
                </div>
                <div class="growth-list" style="margin-top:16px;">
                  <div class="growth-item"><span class="growth-copy"><b>这一阶段</b>独立完成模块，开始写复盘。</span></div>
                  ${
                    next
                      ? `<div class="growth-item"><span class="growth-copy"><b>下一步 · ${escapeHTML(next.name)}</b>${escapeHTML(next.line)}</span></div>`
                      : '<div class="growth-item"><span class="growth-copy"><b>下一步</b>培养更多负责人，把方法传下去。</span></div>'
                  }
                  <div class="growth-item"><span class="growth-copy"><b>8 周后</b>申请带编号的项目证明，把作品写进档案。</span></div>
                </div>
                <button class="text-link reflection-jump" type="button" data-action="focus-reflection">写下这周复盘 <span aria-hidden="true">↗</span></button>
              </section>
            </aside>
          </div>

          ${reflectionSectionMarkup(resident)}
        </div>
      </section>
    `;
  }

  function reflectionSectionMarkup(resident) {
    const entries = Array.isArray(resident.reflections) ? resident.reflections : [];
    return `
      <section class="reflection-section" aria-labelledby="reflection-title">
        <div class="reflection-head">
          <div>
            <span class="eyebrow">Weekly log / 成长档案</span>
            <h2 id="reflection-title">把这一周，留下来。</h2>
            <p>不是考核，也不是周报。写给八周后的自己：做过什么、学到什么、下一步想试什么。</p>
          </div>
          <span class="mono" id="reflection-count">${entries.length} / 8 WEEKS</span>
        </div>
        <div class="reflection-grid">
          <div class="reflection-form">
            <label class="reflection-field">
              <span>这周做成了什么？<small>必填 · 最多 160 字</small></span>
              <textarea id="reflection-did" name="did" maxlength="160" rows="3" placeholder="例如：把岗位筛选的空状态补上，也写清了筛选逻辑。"></textarea>
            </label>
            <label class="reflection-field">
              <span>学到了 / 发现了什么？<small>选填</small></span>
              <textarea id="reflection-learned" name="learned" maxlength="160" rows="3" placeholder="例如：空状态不是装饰，它要告诉用户下一步能做什么。"></textarea>
            </label>
            <label class="reflection-field">
              <span>下周想试什么？<small>选填 · 最多 80 字</small></span>
              <input id="reflection-next" name="next" maxlength="80" type="text" placeholder="例如：找一位真实用户，做一次 10 分钟访谈。">
            </label>
            <div class="reflection-actions">
              <button class="btn btn-primary" type="button" data-action="save-reflection">保存这周复盘 <span aria-hidden="true">↗</span></button>
              <p class="mono">最多保留 8 周 · 只存在本机</p>
            </div>
          </div>
          <div class="reflection-list" id="reflection-list">
            ${reflectionEntriesMarkup(entries)}
          </div>
        </div>
      </section>
    `;
  }

  function reflectionEntriesMarkup(entries) {
    if (!entries.length) {
      return `
        <div class="reflection-empty">
          <span aria-hidden="true">∞</span>
          <p>还没有记录。第一周不用写满，三句话就够。</p>
        </div>
      `;
    }
    const entryMarkup = entries
      .slice()
      .reverse()
      .map(
        (entry) => `
          <article class="reflection-entry">
            <div class="reflection-entry-head">
              <b>第 ${escapeHTML(String(entry.week))} 周</b>
              <span>${escapeHTML(formatDate(entry.createdAt))}</span>
              <button class="reflection-delete" type="button" data-action="delete-reflection" data-reflection-id="${escapeHTML(
                entry.id
              )}" aria-label="删除第 ${escapeHTML(String(entry.week))} 周复盘">删除</button>
            </div>
            ${entry.did ? `<p><b>做成</b>${escapeHTML(entry.did)}</p>` : ""}
            ${entry.learned ? `<p><b>学到</b>${escapeHTML(entry.learned)}</p>` : ""}
            ${entry.next ? `<p><b>下一步</b>${escapeHTML(entry.next)}</p>` : ""}
          </article>
        `
      )
      .join("");
    if (entries.length >= 8) {
      return entryMarkup;
    }
    const used = new Set(entries.map((entry) => entry.week));
    let nextWeek = 1;
    while (used.has(nextWeek) && nextWeek < 8) nextWeek += 1;
    return (
      entryMarkup +
      `
        <div class="reflection-next">
          <span class="mono">NEXT / 第 ${nextWeek} 周</span>
          <p>下周同一时间，回来再写三句话。不是交作业，是给变化留个坐标。</p>
        </div>
      `
    );
  }

  function workspaceTasks(role, dept) {
    return [
      {
        key: "t1",
        title: role ? role.mission : "完成第一个岗位任务",
        desc: "第一个交付 " + (dept ? "· " + dept.name : "")
      },
      {
        key: "t2",
        title: "约一次 25 分钟导师 1:1",
        desc: (dept ? dept.lead + " · " + dept.leadRole : "带教者") + " · 确认节奏与验收标准"
      },
      {
        key: "t3",
        title: "在部门频道发一条自我介绍",
        desc: "一句话：我是谁、我想做什么、我卡在哪里。"
      }
    ];
  }

  function checkItemMarkup(item, resident) {
    const done = Boolean(resident.checklist[item.key]);
    return `
      <button class="check-item ${done ? "is-done" : ""}" type="button" data-action="toggle-check" data-key="${escapeHTML(
      item.key
    )}" aria-pressed="${done ? "true" : "false"}">
        <span class="check-toggle" aria-hidden="true"><svg viewBox="0 0 24 24">${D.ICON_PATHS.check}</svg></span>
        <span class="check-body">
          <span class="check-title">${escapeHTML(item.title)}</span>
          <span class="check-desc">${escapeHTML(item.desc)}</span>
        </span>
      </button>
    `;
  }

  function taskItemMarkup(task, resident) {
    const done = Boolean(resident.tasks[task.key]);
    return `
      <div class="task-item ${done ? "is-done" : ""}" data-task-key="${escapeHTML(task.key)}">
        <span class="task-index" aria-hidden="true">${escapeHTML(task.key.slice(1).padStart(2, "0"))}</span>
        <div>
          <h3>${escapeHTML(task.title)}</h3>
          <p>${escapeHTML(task.desc)}</p>
        </div>
        <button class="task-action" type="button" data-action="toggle-task" data-key="${escapeHTML(task.key)}">${
      done ? "已完成" : "标记完成"
    }</button>
      </div>
    `;
  }

  function workspaceEmptyMarkup() {
    return `
      <section class="workspace-page">
        <div class="container">
          <div class="empty-workspace">
            <div class="empty-infinity" aria-hidden="true">∞</div>
            <h1>你的工位还空着。</h1>
            <p>
              完成 5 分钟线上入职后，这里会出现你的数字工牌、第一周清单、岗位任务和成长路径。所有内容只保存在你的浏览器本地。
            </p>
            <a class="btn btn-primary btn-lg" href="#/join">去领一张工牌 <span class="btn-arrow" aria-hidden="true">↗</span></a>
            <p class="mono" style="margin-top:18px;font-size:8px;letter-spacing:.06em;color:var(--muted);">NO RESIDENT PASS FOUND · SEAT ∞</p>
          </div>
        </div>
      </section>
    `;
  }

  function rankForLevel(level) {
    const map = { 实习: "P1", 初级: "P2", 中级: "P3", 高级: "P4", 负责人: "M1" };
    return D.RANKS.find((rank) => rank.code === map[level]) || D.RANKS[0];
  }

  function nextRank(rank) {
    const index = D.RANKS.indexOf(rank);
    return index >= 0 && index < D.RANKS.length - 1 ? D.RANKS[index + 1] : null;
  }

  /* ---------------- 档案导出与删除 ---------------- */

  function exportData() {
    if (!state.resident) {
      toast("还没有可导出的入职档案。", "error");
      return;
    }
    const payload = {
      app: "STARNEST ∞ / 星巢无限",
      note: "概念公司交互演示导出的本地个人数据。",
      exportedAt: new Date().toISOString(),
      resident: state.resident,
      audit: state.audit
    };
    try {
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "starnest-" + state.resident.id + ".json";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 1500);
      addAudit("导出个人入职档案");
      toast("档案已导出为 JSON 文件。");
    } catch (error) {
      toast("导出失败，请稍后再试。", "error");
    }
  }

  function deleteAllData() {
    const confirmed = window.confirm(
      "确定删除全部本地数据吗？这会移除你的工位、清单、岗位任务与审计记录，且无法恢复。"
    );
    if (!confirmed) {
      return;
    }
    removeStored(RESIDENT_KEY);
    removeStored(DRAFT_KEY);
    removeStored(AUDIT_KEY);
    state.resident = null;
    state.draft = makeDefaultDraft();
    state.audit = [];
    state.joinErrors = {};
    updateChrome();
    toast("已删除全部本地数据。");
    if (state.route.path === "/") {
      renderRoute();
    } else {
      navigate("/");
    }
  }

  function copyId() {
    if (!state.resident) {
      toast("还没有工号可以复制。", "error");
      return;
    }
    copyText(state.resident.id);
  }

  function copyText(text) {
    const done = function () {
      toast("工号已复制：" + text);
    };
    try {
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(done).catch(function () {
          if (fallbackCopy(text)) {
            done();
          } else {
            toast("复制失败，请手动选择工号。", "error");
          }
        });
        return;
      }
    } catch (error) {
      /* fall through */
    }
    if (fallbackCopy(text)) {
      done();
    } else {
      toast("复制失败，请手动选择工号。", "error");
    }
  }

  function fallbackCopy(text) {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "readonly");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch (error) {
      return false;
    }
  }

  /* ---------------- 交互事件 ---------------- */

  function bindEvents() {
    const navToggle = document.getElementById("nav-toggle");
    const mainNav = document.getElementById("main-nav");
    const header = document.getElementById("site-header");
    const dialog = document.getElementById("site-dialog");

    if (navToggle && mainNav) {
      navToggle.addEventListener("click", function () {
        const open = mainNav.classList.toggle("is-open");
        navToggle.setAttribute("aria-expanded", open ? "true" : "false");
        navToggle.setAttribute("aria-label", open ? "关闭导航菜单" : "打开导航菜单");
      });
      mainNav.addEventListener("click", function (event) {
        if (event.target.closest("a")) {
          mainNav.classList.remove("is-open");
          navToggle.setAttribute("aria-expanded", "false");
        }
      });
    }

    if (header) {
      const onScroll = function () {
        header.classList.toggle("is-scrolled", window.scrollY > 8);
      };
      onScroll();
      window.addEventListener("scroll", onScroll, { passive: true });
    }

    const skip = document.querySelector(".skip-link");
    if (skip) {
      skip.addEventListener("click", function (event) {
        event.preventDefault();
        main.focus({ preventScroll: false });
        main.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }

    if (dialog) {
      dialog.addEventListener("click", function (event) {
        if (event.target === dialog) {
          closeDialog();
        }
      });
      dialog.addEventListener("cancel", function (event) {
        event.preventDefault();
        closeDialog();
      });
      dialog.addEventListener("close", function () {
        document.body.style.overflow = "";
      });
    }

    document.addEventListener("click", handleDocumentClick);
    document.addEventListener("input", handleDocumentInput);
    document.addEventListener("change", handleDocumentChange);
    window.addEventListener("hashchange", handleHashChange);

    window.addEventListener("storage", function (event) {
      if (event.key === RESIDENT_KEY) {
        state.resident = loadResident();
        updateChrome();
        if (state.route.path === "/workspace" || state.route.path === "/welcome") {
          renderRoute();
        }
      }
    });
  }

  function handleDocumentClick(event) {
    const actionEl = event.target.closest("[data-action]");
    if (actionEl) {
      const action = actionEl.getAttribute("data-action");
      handleAction(action, actionEl, event);
      return;
    }

    const roleEl = event.target.closest("[data-role]");
    if (roleEl) {
      event.preventDefault();
      openRoleDialog(roleEl.getAttribute("data-role"), roleEl);
      return;
    }

    const quizOption = event.target.closest(".quiz-option");
    if (quizOption) {
      const input = quizOption.querySelector('input[name="quiz"]');
      if (input) {
        input.checked = true;
        state.quiz.answers[state.quiz.index] = Number(input.value);
      }
      return;
    }

    const deptLink = event.target.closest("[data-dept-link]");
    if (deptLink) {
      const deptId = deptLink.getAttribute("data-dept-link");
      if (getDept(deptId)) {
        state.filters = { q: "", dept: deptId, level: "all" };
        if (state.route.path === "/careers") {
          event.preventDefault();
          app.innerHTML = careersMarkup();
          updateChrome();
          initReveal();
        }
      }
      return;
    }

    const chip = event.target.closest("[data-filter-dept]");
    if (chip) {
      state.filters.dept = chip.getAttribute("data-filter-dept");
      updateCareersResults();
      return;
    }
  }

  function handleAction(action, element, event) {
    switch (action) {
      case "close-dialog":
        closeDialog();
        break;
      case "open-compass":
        openCompass();
        break;
      case "compass-option":
        chooseCompass(Number(element.getAttribute("data-index")));
        break;
      case "compass-restart":
        state.compass = { index: 0, scores: {}, done: false };
        {
          const content = document.getElementById("dialog-content");
          if (content) {
            content.innerHTML = compassMarkup();
            const heading = document.getElementById("dialog-title");
            if (heading) heading.focus();
          }
        }
        break;
      case "compass-apply":
        applyRole(element.getAttribute("data-role-id"));
        break;
      case "apply-role":
        applyRole(element.getAttribute("data-role-id"));
        break;
      case "clear-filters":
        state.filters = { q: "", dept: "all", level: "all" };
        app.innerHTML = careersMarkup();
        updateChrome();
        initReveal();
        break;
      case "wizard-next":
        wizardNext();
        break;
      case "wizard-back":
        wizardBack();
        break;
      case "toggle-skill":
        toggleSkill(element.getAttribute("data-skill"), element);
        break;
      case "toggle-check":
        toggleCheck(element.getAttribute("data-key"));
        break;
      case "toggle-task":
        toggleTask(element.getAttribute("data-key"));
        break;
      case "export-data":
        exportData();
        break;
      case "delete-data":
        deleteAllData();
        break;
      case "copy-id":
        copyId();
        break;
      case "toggle-sleep":
        toggleSleep();
        break;
      case "save-reflection":
        saveReflection();
        break;
      case "focus-reflection":
        focusReflection();
        break;
      case "delete-reflection":
        deleteReflection(element.getAttribute("data-reflection-id"));
        break;
      case "quiz-next":
        nextQuiz();
        break;
      case "quiz-retry":
        retryQuiz();
        break;
      case "audit-clear":
        clearAudit();
        break;
      default:
        break;
    }
  }

  function handleDocumentInput(event) {
    const target = event.target;

    if (target.id === "role-search") {
      state.filters.q = target.value;
      updateCareersResults();
      return;
    }

    if (target.matches("[data-field]")) {
      syncField(target);
      if (target.id === "join-motivation") {
        const count = document.getElementById("motivation-count");
        if (count) {
          count.textContent = target.value.length + " / 200";
        }
      }
      if (target.id === "join-role") {
        updateRoleDependentUI();
      }
      clearFieldError(target.dataset.field);
      return;
    }
  }

  function handleDocumentChange(event) {
    const target = event.target;

    if (target.id === "dept-filter") {
      state.filters.dept = target.value;
      updateCareersResults();
      return;
    }
    if (target.id === "level-filter") {
      state.filters.level = target.value;
      updateCareersResults();
      return;
    }
    if (target.matches("[data-field]")) {
      syncField(target);
      if (target.id === "join-role") {
        updateRoleDependentUI();
      }
      clearFieldError(target.dataset.field);
      return;
    }
    if (target.matches("[data-consent]")) {
      state.draft.consents[target.dataset.consent] = Boolean(target.checked);
      saveDraft();
      if (state.joinErrors.consents) {
        delete state.joinErrors.consents;
        const error = document.querySelector(".consent-list + .field-error");
        if (error) {
          error.remove();
        }
      }
      return;
    }
    if (target.name === "quiz") {
      state.quiz.answers[state.quiz.index] = Number(target.value);
      return;
    }
  }

  function syncField(element) {
    const field = element.dataset.field;
    if (!field || !state.draft.form) {
      return;
    }
    if (element.type === "radio" && !element.checked) {
      return;
    }
    assignDraftField(field, element.value);
    saveDraft();
  }

  function clearFieldError(field) {
    if (!field) {
      return;
    }
    delete state.joinErrors[field];
    const input = document.querySelector('[data-field="' + cssEscape(field) + '"]');
    if (input) {
      input.setAttribute("aria-invalid", "false");
      input.removeAttribute("aria-describedby");
    }
    const message = document.getElementById("err-" + field);
    if (message) {
      message.remove();
    }
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(value);
    }
    return String(value).replace(/["\\]/g, "\\$&");
  }

  function toggleSkill(skill, button) {
    if (!D.SKILLS.includes(skill)) {
      return;
    }
    const index = state.draft.skills.indexOf(skill);
    if (index !== -1) {
      state.draft.skills.splice(index, 1);
    } else if (state.draft.skills.length >= 3) {
      toast("最多选 3 个能力。先选最想练的那一个。");
      return;
    } else {
      state.draft.skills.push(skill);
    }
    saveDraft();
    if (button) {
      button.setAttribute(
        "aria-pressed",
        state.draft.skills.indexOf(skill) !== -1 ? "true" : "false"
      );
    }
    updateSkillCount();
    clearFieldError("skills");
  }

  function toggleCheck(key) {
    if (!state.resident || CHECK_KEYS.indexOf(key) === -1) {
      return;
    }
    if (key === "reflection") {
      focusReflection();
      toast(
        state.resident.checklist.reflection
          ? "你写过的那一周还在下面。可以继续补一篇。"
          : "先写下这周做成的一件事，保存后会自动完成这一项。"
      );
      return;
    }
    state.resident.checklist[key] = !state.resident.checklist[key];
    saveResident();
    const item = CHECKLIST.find((entry) => entry.key === key);
    addAudit((state.resident.checklist[key] ? "完成清单：" : "取消清单：") + (item ? item.title : key));
    const button = document.querySelector('[data-action="toggle-check"][data-key="' + cssEscape(key) + '"]');
    if (button) {
      button.classList.toggle("is-done", state.resident.checklist[key]);
      button.setAttribute("aria-pressed", state.resident.checklist[key] ? "true" : "false");
    }
    updateChecklistProgress();
    if (CHECKLIST.every((entry) => state.resident.checklist[entry.key])) {
      toast("入职清单全部完成。第一周可以慢一点，但你已经开始了。");
    }
  }

  function updateChecklistProgress() {
    if (!state.resident) {
      return;
    }
    const checked = CHECKLIST.filter((item) => state.resident.checklist[item.key]).length;
    const percent = Math.round((checked / CHECKLIST.length) * 100);
    const bar = document.querySelector(".progress-bar");
    const fill = document.querySelector(".progress-bar i");
    const percentLabel = document.getElementById("checklist-percent");
    const count = document.querySelector("#checklist") ? document.querySelector("#checklist").closest(".panel") : null;
    if (bar) {
      bar.setAttribute("aria-valuenow", String(percent));
    }
    if (fill) {
      fill.style.setProperty("--progress", percent + "%");
    }
    if (percentLabel) {
      percentLabel.textContent = percent + "%";
    }
    if (count) {
      const label = count.querySelector(".panel-head .mono");
      if (label) {
        label.textContent = checked + " / " + CHECKLIST.length + " DONE";
      }
    }
  }

  function toggleTask(key) {
    if (!state.resident || TASK_KEYS.indexOf(key) === -1) {
      return;
    }
    state.resident.tasks[key] = !state.resident.tasks[key];
    saveResident();
    addAudit((state.resident.tasks[key] ? "完成任务：" : "取消任务：") + key.toUpperCase());
    const item = document.querySelector('[data-task-key="' + cssEscape(key) + '"]');
    if (item) {
      item.classList.toggle("is-done", state.resident.tasks[key]);
      const button = item.querySelector('[data-action="toggle-task"]');
      if (button) {
        button.textContent = state.resident.tasks[key] ? "已完成" : "标记完成";
      }
    }
    if (state.resident.tasks[key]) {
      toast("任务已标记完成。记得在复盘里写下你学到的那一句。");
    }
  }

  function toggleSleep() {
    if (!state.resident) {
      return;
    }
    const paused = state.resident.status === "paused";
    state.resident.status = paused ? "active" : "paused";
    saveResident();
    addAudit(paused ? "恢复工位" : "申请休眠工位");
    toast(paused ? "欢迎回来，工位已恢复。" : "工位已进入休眠。随时可以回来。");
    renderRoute();
  }

  function saveReflection() {
    if (!state.resident) {
      return;
    }
    const did = cleanText(document.getElementById("reflection-did")?.value, 160);
    const learned = cleanText(document.getElementById("reflection-learned")?.value, 160);
    const next = cleanText(document.getElementById("reflection-next")?.value, 80);
    if (did.length < 2) {
      toast("先写下这周做成的一件事，哪怕很小。", "error");
      document.getElementById("reflection-did")?.focus();
      return;
    }
    if (!Array.isArray(state.resident.reflections)) {
      state.resident.reflections = [];
    }
    if (state.resident.reflections.length >= 8) {
      toast("8 周复盘已经写满。可以删掉一条，再写新的。");
      return;
    }
    let week =
      state.resident.reflections.reduce((max, entry) => Math.max(max, Number(entry.week) || 0), 0) + 1;
    if (week > 8) {
      const used = new Set(state.resident.reflections.map((entry) => entry.week));
      let openWeek = 1;
      while (used.has(openWeek) && openWeek < 8) openWeek += 1;
      week = openWeek;
    }
    const entry = {
      id: "log-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6),
      week: week,
      did: did,
      learned: learned,
      next: next,
      createdAt: new Date().toISOString()
    };
    state.resident.reflections.push(entry);
    state.resident.checklist.reflection = true;
    saveResident();
    addAudit("写下第 " + week + " 周复盘");
    ["reflection-did", "reflection-learned", "reflection-next"].forEach(function (id) {
      const field = document.getElementById(id);
      if (field) field.value = "";
    });
    const reflectionCheck = document.querySelector(
      '[data-action="toggle-check"][data-key="reflection"]'
    );
    if (reflectionCheck) {
      reflectionCheck.classList.add("is-done");
      reflectionCheck.setAttribute("aria-pressed", "true");
    }
    updateChecklistProgress();
    refreshReflectionPanel();
    toast("第 " + week + " 周复盘已保存。它不是考核，是你留给自己的证据。");
  }

  function deleteReflection(id) {
    if (!state.resident || !Array.isArray(state.resident.reflections)) {
      return;
    }
    const entry = state.resident.reflections.find((item) => item.id === id);
    if (!entry) {
      return;
    }
    const confirmed = window.confirm("删除第 " + entry.week + " 周复盘？此操作不可恢复。");
    if (!confirmed) {
      return;
    }
    state.resident.reflections = state.resident.reflections.filter((item) => item.id !== id);
    saveResident();
    addAudit("删除第 " + entry.week + " 周复盘");
    refreshReflectionPanel();
    toast("已删除第 " + entry.week + " 周复盘。");
  }

  function refreshReflectionPanel() {
    if (!state.resident) {
      return;
    }
    const list = document.getElementById("reflection-list");
    const count = document.getElementById("reflection-count");
    const entries = Array.isArray(state.resident.reflections) ? state.resident.reflections : [];
    if (list) {
      list.innerHTML = reflectionEntriesMarkup(entries);
    }
    if (count) {
      count.textContent = entries.length + " / 8 WEEKS";
    }
  }

  function focusReflection() {
    const title = document.getElementById("reflection-title");
    if (title) {
      title.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    window.setTimeout(function () {
      const field = document.getElementById("reflection-did");
      if (field) field.focus({ preventScroll: true });
    }, 320);
  }

  function clearAudit() {
    if (!state.audit.length) {
      return;
    }
    const confirmed = window.confirm("清空全部本地审计记录？此操作不可恢复。");
    if (!confirmed) {
      return;
    }
    state.audit = [];
    removeStored(AUDIT_KEY);
    refreshAuditPanel();
    toast("本地审计已清空。");
  }

  function handleHashChange() {
    if (window.location.hash === "#main") {
      main.focus();
      return;
    }
    closeDialog(true);
    state.route = parseHash();
    state.joinErrors = {};
    renderRoute();
    const navToggle = document.getElementById("nav-toggle");
    const mainNav = document.getElementById("main-nav");
    if (navToggle && mainNav && window.innerWidth <= 920) {
      mainNav.classList.remove("is-open");
      navToggle.setAttribute("aria-expanded", "false");
    }
  }

  /* ---------------- 找不到页面 ---------------- */

  function notFoundMarkup() {
    return `
      <section class="page-hero">
        <div class="container">
          <div class="page-hero-grid">
            <div>
              <span class="eyebrow">404 / ROUTE NOT FOUND</span>
              <h1>这条航线<br>还没<em>开通</em>。</h1>
              <p class="page-hero-copy">你访问的页面不存在，可能是一次误触，也可能是一个还没被设计出来的入口。</p>
              <div class="page-actions">
                <a class="btn btn-primary" href="#/">回到首页 <span class="btn-arrow" aria-hidden="true">↗</span></a>
                <a class="btn btn-ghost" href="#/careers">看看开放岗位</a>
              </div>
            </div>
            <aside class="page-hero-aside">
              <strong>∞</strong>
              <span>SEAT STILL AVAILABLE</span>
              <p>迷路也没关系。所有岗位都不设名额，你可以随时重新开始。</p>
            </aside>
          </div>
        </div>
      </section>
    `;
  }

  /* ---------------- 启动 ---------------- */

  function init() {
    if (!window.location.hash || window.location.hash === "#") {
      try {
        window.history.replaceState(null, "", "#/");
      } catch (error) {
        /* ignore */
      }
    }
    state.route = parseHash();
    bindEvents();
    renderRoute();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
