'use strict';
(() => {
  const section = document.querySelector('#contact'), codeForm = document.querySelector('#contact-code-form');
  const details = document.querySelector('#contact-details-form'), codeInput = document.querySelector('#contact-code');
  const emailInput = document.querySelector('#contact-email'), consent = document.querySelector('#contact-consent');
  const remove = document.querySelector('#contact-remove'), confirm = document.querySelector('#contact-delete-confirm');
  const status = document.querySelector('#contact-status'), player = document.querySelector('#contact-player');
  const surfaces = ['.intro', '#ranking', '#how-to'].map(selector => document.querySelector(selector));
  const changeCode = document.querySelector('#contact-change-code');
  const purpose = 'competition-results-v1';
  let activeCode = '', pending = false, currentController;
  function message(text, error = false) { status.textContent = text; status.dataset.error = String(error); }
  function setPending(value) {
    pending = value;
    section.querySelectorAll('button,input').forEach(element => { element.disabled = value; });
    section.setAttribute('aria-busy', String(value));
  }
  function friendlyError(code) {
    if (code === 410) return 'コードの有効期限が切れました。アプリで新しいQRコードを発行してください。';
    if (code === 409) return 'このコードは使用済みです。アプリで新しいQRコードを発行してください。';
    if (code === 429) return '操作回数が上限に達しました。しばらく待ってからお試しください。';
    if (code === 400) return '入力内容と同意のチェックを確認してください。';
    return '通信できませんでした。入力内容を確認して、もう一度お試しください。';
  }
  async function post(path, payload) {
    if (!window.KEY_DASH_API_URL) throw new Error('ただいま準備中です。');
    const controller = new AbortController(); currentController = controller;
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(`${window.KEY_DASH_API_URL}/v1${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'omit', cache: 'no-store', body: JSON.stringify(payload), signal: controller.signal
      });
      if (!response.ok) throw new Error(friendlyError(response.status));
      return await response.json();
    } catch (error) {
      if (error instanceof TypeError || error.name === 'AbortError') throw new Error(friendlyError(0));
      throw error;
    } finally { clearTimeout(timer); currentController = undefined; }
  }
  function open(code = '') {
    if (pending) return;
    section.hidden = false; surfaces.forEach(surface => { surface.hidden = true; });
    codeForm.hidden = false; changeCode.hidden = true;
    details.hidden = true; confirm.hidden = true; activeCode = '';
    emailInput.value = ''; consent.checked = false; codeInput.value = code;
    message(''); document.querySelector('#contact-title').focus();
    if (code) lookup();
  }
  async function lookup() {
    if (pending) return;
    const code = codeInput.value.replace(/[-\s]/g, '').toUpperCase();
    if (!/^[A-HJ-NP-Z2-9]{12}$/.test(code)) { message('12文字のコードを入力してください。', true); return; }
    emailInput.value = ''; consent.checked = false; activeCode = '';
    setPending(true); message('プレイヤーを確認しています。'); details.hidden = true;
    try {
      const data = await post('/contact-links/lookup', { code });
      if (!/^[A-Za-z0-9_-]{3,12}$/.test(data.name) || data.purpose !== purpose) throw new Error('プレイヤー情報を取得できませんでした。');
      codeForm.hidden = true; changeCode.hidden = false;
      activeCode = code; player.textContent = `プレイヤー：${data.name}`;
      details.hidden = false; confirm.hidden = true; remove.hidden = !data.has_contact;
      message(data.has_contact ? '登録済みの連絡先を変更・削除できます。' : 'メールは任意です。登録せずにランキングへ戻ることもできます。');
    } catch (error) { activeCode = ''; message(error.message, true); }
    finally { setPending(false); if (!details.hidden) emailInput.focus(); }
  }
  async function mutate(action) {
    if (pending || !activeCode) return;
    // Read values before disabling fields. Never store the address or code in localStorage.
    const payload = { code: activeCode, action };
    if (action === 'save') Object.assign(payload, { email: emailInput.value.trim(), consent: consent.checked, purpose });
    setPending(true); message(action === 'save' ? '連絡先を保存しています。' : '連絡先を削除しています。');
    try {
      const result = await post('/contact', payload);
      if (result.action !== action) throw new Error('処理結果を確認できませんでした。もう一度お試しください。');
      codeForm.hidden = false; changeCode.hidden = true;
      activeCode = ''; codeInput.value = ''; emailInput.value = ''; consent.checked = false;
      details.hidden = true; confirm.hidden = true;
      message(action === 'save' ? '連絡先を保存しました。ランキングには公開されません。' : '連絡先を削除しました。ランキングの記録はそのままです。');
      status.focus();
    } catch (error) { message(error.message, true); }
    finally { setPending(false); }
  }
  changeCode.addEventListener('click', () => {
    activeCode = ''; details.hidden = true; confirm.hidden = true; changeCode.hidden = true; codeForm.hidden = false;
    codeInput.value = ''; emailInput.value = ''; consent.checked = false; message(''); codeInput.focus();
  });
  codeInput.addEventListener('input', () => {
    if (pending) return;
    activeCode = ''; details.hidden = true; confirm.hidden = true; emailInput.value = ''; consent.checked = false;
  });
  codeForm.addEventListener('submit', event => { event.preventDefault(); lookup(); });
  details.addEventListener('submit', event => { event.preventDefault(); if (details.reportValidity()) mutate('save'); });
  remove.addEventListener('click', () => { confirm.hidden = false; document.querySelector('#contact-delete-yes').focus(); });
  document.querySelector('#contact-delete-yes').addEventListener('click', () => mutate('delete'));
  document.querySelector('#contact-delete-no').addEventListener('click', () => { confirm.hidden = true; remove.focus(); });
  document.querySelector('#open-contact').addEventListener('click', () => open());
  function closeContact() {
    if (pending) return;
    currentController?.abort(); section.hidden = true; surfaces.forEach(surface => { surface.hidden = false; });
    activeCode = ''; emailInput.value = ''; consent.checked = false; codeInput.value = '';
    document.querySelector('#open-contact').focus();
  }
  document.querySelector('#close-contact').addEventListener('click', closeContact);
  document.querySelectorAll('a[href="#how-to"],a[href="#ranking"]').forEach(link => link.addEventListener('click', event => {
    if (pending) { event.preventDefault(); return; }
    if (!section.hidden) closeContact();
  }));
  const initial = location.hash.match(/^#contact=([A-HJ-NP-Z2-9]{12})$/)?.[1];
  if (initial) {
    // Remove the short-lived code from the visible URL after reading the fragment.
    history.replaceState(null, '', location.pathname + location.search);
    open(initial);
  }
})();
