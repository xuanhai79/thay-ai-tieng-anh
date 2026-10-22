// Ban web tinh (GitHub Pages): thay cho server.py ngay trong trinh duyet.
// Bat moi fetch('/api/...') cua index.html, tra loi giong server; thay AI goi thang Gemini bang key
// nguoi dung dan o ⚙ (chi luu trong may nay, localStorage 'thayai_cfg'). Khong co tai khoan: tien do luu theo may.
(function () {
  const GEM = "https://generativelanguage.googleapis.com/v1beta/models/";
  const realFetch = window.fetch.bind(window);
  let CUR = null;
  const cfg = () => { try { return Object.assign({ model: "gemini-flash-lite-latest", api_key: "" },
    JSON.parse(localStorage.getItem("thayai_cfg") || "{}")); } catch (e) { return { model: "gemini-flash-lite-latest", api_key: "" }; } };
  const json = (data, status) => new Response(JSON.stringify(data), { status: status || 200,
    headers: { "Content-Type": "application/json" } });
  const fail = (status, detail) => { const e = new Error(detail); e.status = status; return e; };
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function curriculum() {
    if (!CUR) CUR = await (await realFetch("curriculum.json")).json();
    return CUR;
  }
  async function unitInfo(grade, idx) {
    const c = await curriculum();
    const g = c.grades[String(grade)] || c.extra[String(grade)];
    if (!g) throw fail(404, "Không có lớp này.");
    return [g, g.units[idx] !== undefined && idx >= 0 ? g.units[idx] : g.units[0]];
  }

  // giong gemini() cua server.py: tu thu lai khi qua tai
  async function gemini(messages, wantJson, temperature) {
    const c = cfg();
    if (!c.api_key) throw fail(400, "Chưa có API key Gemini. Mở ⚙ Cài đặt để dán key (miễn phí ở aistudio.google.com/apikey).");
    const sys = messages.filter(m => m.role === "system").map(m => m.content).join("\n");
    const contents = [];
    for (const m of messages.filter(m => m.role !== "system")) {
      const role = m.role === "assistant" ? "model" : "user";
      const last = contents[contents.length - 1];
      if (last && last.role === role) last.parts[0].text += "\n" + m.content;  // Gemini can xen ke user/model
      else contents.push({ role, parts: [{ text: m.content }] });
    }
    const gen = { temperature: temperature ?? 0.6 };
    if (wantJson) gen.responseMimeType = "application/json";
    if (!/lite/.test(c.model)) gen.thinkingConfig = { thinkingBudget: 0 };  // tat suy nghi cho nhanh
    const body = { contents, generationConfig: gen };
    if (sys) body.systemInstruction = { parts: [{ text: sys }] };
    return callGemini(c, body);
  }

  async function callGemini(c, body, tries) {
    let lastErr = "";
    for (let i = 0; i < (tries || 5); i++) {
      let r;
      try {
        r = await realFetch(GEM + encodeURIComponent(c.model) + ":generateContent", { method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": c.api_key }, body: JSON.stringify(body) });
      } catch (e) { lastErr = String(e); await sleep(2000 * (i + 1)); continue; }
      const t = await r.text();
      if (r.ok) {
        const d = JSON.parse(t);
        return ((d.candidates || [])[0]?.content?.parts || []).map(p => p.text || "").join("");
      }
      lastErr = t.slice(0, 200);
      if ([429, 500, 502, 503, 529].includes(r.status)) { await sleep(2000 * (i + 1)); continue; }
      if (r.status === 400 && /API key/i.test(t)) throw fail(400, "API key Gemini không đúng. Mở ⚙ Cài đặt để dán lại.");
      throw fail(502, "Gemini lỗi " + r.status + ": " + lastErr);
    }
    throw fail(502, "Gemini bận, thử lại sau. (" + lastErr + ")");
  }

  // nghe giong hoc sinh: ghi am -> Gemini chep lai, CO NGU CANH (lop, bai, cau thay vua hoi) cho nghe dung hon.
  // Thu mo hinh nghe tot hon (STT_MODEL) truoc, ban / het luot thi ve mo hinh trong ⚙.
  const STT_MODEL = "gemini-flash-latest";
  function sttPrompt(g, unit, last) {
    return `Đây là ghi âm một học sinh Việt Nam ${g ? g.ten : ""} đang học tiếng Anh` + (unit ? `, bài "${unit}"` : "") + ". "
      + (last ? `Thầy vừa nói / hỏi: "${String(last).slice(0, 300)}". ` : "")
      + "Học sinh trả lời: giọng trẻ em, phát âm chưa chuẩn, có thể nói tiếng Việt. Hãy chép lại câu học sinh nói. "
      + "Khi âm nghe giống, ưu tiên từ tiếng Anh hợp với bài học và câu hỏi của thầy; KHÔNG tự sửa ngữ pháp, không thêm từ "
      + "học sinh không nói. Nói tiếng Việt thì chép tiếng Việt. Chỉ trả về đúng câu đã nói; không có lời nói thì trả về chuỗi rỗng.";
  }
  async function sttAudio(b64, mime, ctx) {
    const c = cfg();
    if (!c.api_key) throw fail(400, "Chưa có API key Gemini. Mở ⚙ Cài đặt để dán key.");
    let g = null, unit = "";
    try { if (ctx.grade) [g, unit] = await unitInfo(ctx.grade, ctx.unit || 0); } catch (e) {}
    const body = model => {
      const gen = { temperature: 0 };
      if (!/lite/.test(model)) gen.thinkingConfig = { thinkingBudget: 0 };
      return { generationConfig: gen, contents: [{ role: "user", parts: [
        { inline_data: { mime_type: mime || "audio/mp4", data: b64 } }, { text: sttPrompt(g, unit, ctx.last) }] }] };
    };
    let out;
    try { out = await callGemini(Object.assign({}, c, { model: STT_MODEL }), body(STT_MODEL), 1); }
    catch (e) { if (c.model === STT_MODEL) throw e; out = await callGemini(c, body(c.model)); }
    return out.trim().replace(/^["']|["']$/g, "");
  }

  // ---- loi day cua thay: chep tu server.py (teacher_system) ----
  function teacherSystem(g, unit, mode) {
    const tv = !!g.giai_thich_tv, lv = g.level || "beginner";
    const ngonNgu = tv
      ? "Nói CHẬM, câu RẤT NGẮN và đơn giản. Giải thích bằng tiếng Việt khi cần, rồi cho mẫu tiếng Anh. Khen ngợi nhiều, kiên nhẫn như cô giáo dạy trẻ nhỏ."
      : "Nói chủ yếu bằng tiếng Anh, câu vừa sức. Chỉ dùng tiếng Việt khi học sinh không hiểu.";
    const nv = {
      learn: "Dạy bài: giới thiệu 4-6 từ vựng chính của chủ đề (kèm phiên âm đơn giản và nghĩa tiếng Việt), cho 1-2 mẫu câu, rồi mời học sinh đọc theo và hỏi lại để luyện. Mỗi lượt chỉ dạy MỘT ít, hỏi 1 câu.",
      talk: "Trò chuyện giao tiếp qua lại như người thật: hỏi học sinh 1 câu về chủ đề, nghe trả lời, sửa nhẹ nhàng lỗi quan trọng (chỉ 1 lỗi/lượt), rồi hỏi tiếp. Giữ hội thoại tự nhiên, vui.",
      quiz: "Hỏi học sinh từng câu hỏi ngắn (miệng) về chủ đề, nghe đáp, chấm đúng/sai và giải thích ngắn."
    }[mode] || "Dạy bài.";
    return `Bạn là thầy/cô giáo tiếng Anh thân thiện trong app học cho học sinh Việt Nam ${g.ten} (trình độ ${lv}). Chủ đề đang học: "${unit}".\n${ngonNgu}\nNhiệm vụ: ${nv}\n`
      + "Lời học sinh được nhận từ giọng nói nên có thể sai vài chữ: hãy đoán ý học sinh muốn nói theo ngữ cảnh, KHÔNG chấm sai hay bắt lỗi chỉ vì chữ bị nhận nhầm (chỉ sửa lỗi thật sự về từ / ngữ pháp). "
      + "QUAN TRỌNG: trả lời NGẮN (2-4 câu), vì câu trả lời sẽ được ĐỌC TO cho học sinh nghe. Không dùng ký hiệu markdown, không gạch đầu dòng dài. Luôn kết thúc bằng một câu hỏi hoặc lời mời học sinh nói.";
  }

  const API = {
    "GET /api/curriculum": () => curriculum(),
    "GET /api/settings": () => { const c = cfg(); return { model: c.model, api_key: c.api_key ? "•".repeat(8) + c.api_key.slice(-4) : "" }; },
    "POST /api/settings": b => {
      const c = cfg();
      if (b.model) c.model = b.model.trim();
      if (b.api_key && !b.api_key.startsWith("•")) c.api_key = b.api_key.trim();
      localStorage.setItem("thayai_cfg", JSON.stringify(c));
      return { ok: true };
    },
    "POST /api/teacher": async b => {
      const [g, unit] = await unitInfo(b.grade, b.unit || 0);
      const msgs = [{ role: "system", content: teacherSystem(g, unit, b.mode || "learn") }];
      const hist = (b.history || []).slice(-12);
      for (const m of hist) msgs.push({ role: m.role || "user", content: m.content || "" });
      const lastH = hist[hist.length - 1];
      if (b.message && !(lastH && lastH.role === "user" && lastH.content === b.message))
        msgs.push({ role: "user", content: b.message });
      else if (!b.message && !hist.length) msgs.push({ role: "user", content: "(Học sinh vừa mở bài. Hãy chào và bắt đầu.)" });
      return { reply: await gemini(msgs, false, 0.6) };
    },
    "POST /api/quiz": async b => {
      const [g, unit] = await unitInfo(b.grade, b.unit || 0);
      const n = b.n || 5, tv = !!g.giai_thich_tv;
      const sys = `Soạn ${n} câu trắc nghiệm tiếng Anh cho học sinh Việt Nam ${g.ten} về chủ đề "${unit}", trình độ ${g.level}. Mỗi câu có 4 lựa chọn, 1 đáp án đúng. `
        + (tv ? "Câu hỏi và giải thích bằng tiếng Việt, đáp án là từ/câu tiếng Anh. " : "Dùng tiếng Anh, giải thích ngắn bằng tiếng Việt. ")
        + 'Trả về JSON đúng dạng: {"questions":[{"q":"...","options":["A","B","C","D"],"answer":0,"explain":"..."}]}. answer là chỉ số (0-3) của đáp án đúng.';
      const raw = await gemini([{ role: "system", content: sys }, { role: "user", content: "Soạn đề đi." }], true, 0.8);
      let qs;
      try { const d = JSON.parse(raw); qs = d.questions || d.cau || []; if (!qs.length || !qs.every(q => "options" in q && "answer" in q)) throw 0; }
      catch (e) { throw fail(502, "Thầy AI soạn đề chưa đúng dạng, thử lại."); }
      return { questions: qs.slice(0, n), unit };
    },
    "POST /api/vocab": async b => {
      const [g, unit] = await unitInfo(b.grade, b.unit || 0);
      const n = b.n || 6;
      const sys = `Chọn ${n} từ vựng tiếng Anh QUAN TRỌNG và dễ nhất cho học sinh Việt Nam ${g.ten} về chủ đề "${unit}". Mỗi từ kèm nghĩa tiếng Việt và MỘT emoji minh hoạ hợp nhất (hình ảnh con/vật/đồ). `
        + "Chọn từ cụ thể, có thể vẽ bằng emoji (ví dụ apple 🍎, dog 🐶, book 📚). "
        + 'Trả về JSON đúng dạng: {"words":[{"en":"apple","vi":"quả táo","emoji":"🍎"}]}.';
      const raw = await gemini([{ role: "system", content: sys }, { role: "user", content: "Chọn từ đi." }], true, 0.5);
      let ws;
      try { ws = (JSON.parse(raw).words || []).filter(w => w.en && w.emoji).slice(0, n); if (!ws.length) throw 0; }
      catch (e) { throw fail(502, "Thầy AI chọn từ chưa đúng dạng, thử lại."); }
      return { words: ws, unit };
    },
    "POST /api/stt": async b => {
      if (!b.audio) throw fail(400, "Không có ghi âm.");
      return { text: await sttAudio(b.audio, b.mime, b) };
    },
    "POST /api/login": () => { throw fail(400, "Bản web không có tài khoản: sao và tiến độ lưu ngay trên máy này."); },
    "POST /api/register": () => { throw fail(400, "Bản web không có tài khoản: sao và tiến độ lưu ngay trên máy này."); },
    "GET /api/progress": () => { throw fail(401, "Không có tài khoản"); },
    "POST /api/progress": () => { throw fail(401, "Không có tài khoản"); },
  };

  window.fetch = async function (input, init) {
    const url = typeof input === "string" ? input : input.url;
    const path = new URL(url, location.href).pathname.replace(/^.*(\/api\/)/, "/api/");
    if (!/^\/api\//.test(path) || new URL(url, location.href).origin !== location.origin) return realFetch(input, init);
    const method = ((init && init.method) || "GET").toUpperCase();
    const h = API[method + " " + path];
    if (!h) return json({ detail: "Không có" }, 404);
    try {
      const body = init && init.body ? JSON.parse(init.body) : {};
      return json(await h(body));
    } catch (e) {
      return json({ detail: e.message || String(e) }, e.status || 500);
    }
  };
})();
