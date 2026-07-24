const cds = require("@sap/cds");
const { purgeExpiredCheckpoints } = require("./dist/index");
const { getActiveTenants } = require("./lib/tenancy-utils");

const LOG = cds.log("cds-langgraph-persistence");

// Register the 'langgraph-persistence' plugin for the 'cds add' command
cds.add?.register(
  "langgraph-persistence",
  require("./lib/add").AddLangGraphPersistencePlugin,
);

cds.on("loaded", (model) => {
  if (!model.definitions["plugin.langgraph.persistence"]) {
    LOG.warn(
      `Detected '@mi8y/cds-langgraph-persistence' CDS plugin installation, but no entities found in the model. ` +
        `Did you forget to run 'cds add langgraph-persistence' after installing the package?`,
    );
  }
});

/**
 * Entry point for the checkpoint TTL sweeper which runs periodically in the background to purge expired checkpoints.
 *
 * Dispatches to the correct strategy based on multitenancy configuration:
 * - **Single-tenancy**: runs `purgeExpiredCheckpoints` directly.
 * - **Multitenancy with SaaS Provisioning**: enumerates active tenants and
 *   runs the sweeper in each tenant's context.
 * - **Multitenancy without SaaS Provisioning**: logs a warning and skips
 *   sweeping, since tenant enumeration is not possible.
 */
cds.on("served", () => {
  const { checkpointer } = cds.env.requires["cds-langgraph-persistence"];

  // configuration validation
  if (checkpointer && checkpointer.ttl && !checkpointer.ttl.sweepIntervalMs) {
    LOG.warn(
      `Invalid TTL configuration for 'cds-langgraph-persistence': missing 'checkpointer.ttl.sweepIntervalMs' config`,
    );
    return;
  }

  // check if multitenancy is enabled and SaaS Provisioning Service is available
  const isMultitenant = cds.requires?.multitenancy;
  if (isMultitenant && !cds.requires?.["cds.xt.SaasProvisioningService"]) {
    LOG.warn(
      "Multitenancy is enabled but `cds.xt.SaasProvisioningService` is disabled. " +
        "TTL checkpoint sweeping cannot enumerate tenants and will not run.",
    );
    return;
  }

  /**
   * Sweeps expired checkpoints for all active tenants (if multitenant) or for the single tenant (if single-tenant).
   * This function is called recursively with a timeout based on the configured sweep interval.
   * In multitenant mode, it enumerates active tenants and spawns a separate context for each tenant to run the sweep.
   * In single-tenant mode, it runs the sweep directly in the current context.
   */
  async function sweepExpiredCheckpoints() {
    if (isMultitenant) {
      const tenantIds = await getActiveTenants(cds);
      for (const tenantId of tenantIds) {
        cds
          .spawn({ tenant: tenantId }, async () => {
            const purgeThreadInfo = await purgeExpiredCheckpoints();
            LOG.info(
              `Swept expired checkpoints for tenant ${tenantId}: ${purgeThreadInfo.expired} expired threads deleted, ${purgeThreadInfo.skipped} threads skipped due to interrupted or in-progress state`,
            );
          })
          .on("failed", (err) => {
            LOG.error(
              `Error occurred while sweeping expired checkpoints for tenant ${tenantId}: ${err.message}`,
            );
          });
      }
    } else {
      cds
        .spawn(async () => {
          const purgeThreadInfo = await purgeExpiredCheckpoints();
          LOG.info(
            `Swept expired checkpoints: ${purgeThreadInfo.expired} expired threads deleted, ${purgeThreadInfo.skipped} threads skipped due to interrupted or in-progress state`,
          );
        })
        .on("failed", (err) => {
          LOG.error(
            `Error occurred while sweeping expired checkpoints: ${err.message}`,
          );
        });
    }

    setTimeout(sweepExpiredCheckpoints, checkpointer.ttl.sweepIntervalMs);
  }
  sweepExpiredCheckpoints();
});
