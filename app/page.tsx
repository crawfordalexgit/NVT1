import { redirect } from "next/navigation";

export default function Home() {
  // Redirect root to the report page by default
  redirect("/report");
  return null;
}
