// Shared by Today and Stats → Overview.

// Carts with no order from that browser since.
export const openCartsOf = (carts) => (Array.isArray(carts) ? carts.filter((c) => !c.ordered) : []);
