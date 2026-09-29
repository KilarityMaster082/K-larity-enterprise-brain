// Owner task: EB-23 Web UI shell — the home page is Ask Brain.
import { redirect } from "next/navigation";

export default function Home() {
  redirect("/ask");
}
