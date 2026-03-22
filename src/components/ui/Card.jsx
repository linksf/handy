export default function Card({ children, style }) {
  return (
    <div style={{
      background: "#fff",
      borderRadius: 10,
      border: "1px solid #bdc3c7",
      boxShadow: "0 1px 3px rgba(0,0,0,.06)",
      padding: 16,
      ...style,
    }}>
      {children}
    </div>
  );
}
