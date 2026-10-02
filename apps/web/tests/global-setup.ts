import { resetDatabase } from "@chipa/db/reset";

export default async function setup() {
  await resetDatabase(process.env.TEST_DATABASE_URL ?? "postgres://chipa:chipa@localhost:5433/chipa_test", {
    demo: true,
  });
}
