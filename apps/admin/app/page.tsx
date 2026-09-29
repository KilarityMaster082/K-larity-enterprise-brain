// Owner task: EB-100 Admin console shell — home is the tenant list.
import { redirect } from "next/navigation";

export default function Home() {
  redirect("/tenants");
}
