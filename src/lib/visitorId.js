// One anonymous ID per browser, so the Chats page can group a person's
// conversations (and their Journeys pages) together. Falls back to a
// throwaway ID if storage is off.
const VISITOR_KEY = "askAiVisitorId";

export const getVisitorId = () => {
  try {
    let id = localStorage.getItem(VISITOR_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(VISITOR_KEY, id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
};
