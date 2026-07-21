export function generateOpaqueCustomerId() {
  let id = "";
  while (id.length < 18) {
    id += Math.floor(Math.random() * 1e15)
      .toString()
      .padStart(15, "0");
  }
  return id.slice(0, 18);
}

export function isOpaqueCustomerId(value) {
  return /^\d{15,20}$/.test(String(value || "").trim());
}
