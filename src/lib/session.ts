export function getSessionId(): string {
  let sid = localStorage.getItem('expense_session_id');
  if (!sid) {
    sid = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    localStorage.setItem('expense_session_id', sid);
  }
  return sid;
}
