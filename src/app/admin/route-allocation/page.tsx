import { redirect } from "next/navigation";

export default function RouteAllocationRedirect() {
  redirect("/admin/smart-allocation?tab=buses");
}
