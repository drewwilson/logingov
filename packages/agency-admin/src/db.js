/**
 * Isolated database client — exposes agencies + service_providers tables.
 * Importing user/auth tables from here is a compile-time error.
 */
import { Client } from "@planetscale/database";
import { drizzle } from "drizzle-orm/planetscale-serverless";
import * as agencySchema from "@logingov/shared/schema/agency";
export function getAgencyDb(url) {
    const client = new Client({ url });
    return drizzle(client, { schema: agencySchema });
}
export { agencySchema };
