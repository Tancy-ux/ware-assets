// Team-only modules swapped out of the store build (see vite.config.js).
// The customer chat never reaches them; these just keep the imports valid
// without shipping the team tools (or supabase-js) to shoppers.
export const supabase = null;
export const toast = { success() {}, error() {}, info() {} };
const Nothing = () => null;
export default Nothing;
