/* reset.js — 다른 스크립트보다 먼저 실행된다. 주소를 #reset 으로 열면 이 앱의 브라우저 기록
   (페이스패스 등록, 응시·시선 기록, 목표, 칭찬, 피드백, 로그인 상태)을 모두 지우고 첫 화면에서 시작한다. */
if (location.hash === '#reset') {
  for (const key of Object.keys(localStorage)) if (key.startsWith('lookteracy-')) localStorage.removeItem(key);
  try { sessionStorage.clear(); } catch {}
  history.replaceState(null, '', '#landing');
  window.lookteracyWasReset = true;
}
