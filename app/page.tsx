// Static placeholder page with NO sensitive data, NO environment variables, and NO database queries.

export const dynamic = "force-static";

export default function HomePage() {
  return (
    <main
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        textAlign: "center",
        padding: "1rem",
      }}
    >
      <div
        style={{
          border: "1px solid rgba(255, 255, 255, 0.1)",
          borderRadius: "8px",
          padding: "2rem 3rem",
          backgroundColor: "#16181f",
          maxWidth: "400px",
        }}
      >
        <h1 style={{ fontSize: "1.25rem", margin: "0 0 0.5rem 0", color: "#e5e7eb" }}>
          Service Online
        </h1>
        <p style={{ fontSize: "0.875rem", margin: 0, color: "#9ca3af" }}>
          Internal integration gateway.
        </p>
      </div>
    </main>
  );
}
