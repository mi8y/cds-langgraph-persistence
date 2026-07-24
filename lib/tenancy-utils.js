const cds = require("@sap/cds");

const LOG = cds.log("cds-langgraph-persistence");

/**
 * Enumerates active tenants from the SaaS Provisioning Service.
 *
 * @returns {Promise<string[]>} list of subscribed tenant IDs
 */
async function getActiveTenants() {
  try {
    const provisioning = await cds.connect.to("cds.xt.SaasProvisioningService");
    const result = await provisioning.send({
      method: "GET",
      path: "/tenant",
    });

    const tenants = Array.isArray(result) ? result : (result?.value ?? []);
    return tenants
      .filter((t) => t.eventType === "CREATE" || t.eventType === "UPDATE")
      .map((t) => t.subscribedTenantId);
  } catch (err) {
    LOG.error(
      "Failed to enumerate tenants from SaasProvisioningService:",
      err.message,
    );
    return [];
  }
}

module.exports = { getActiveTenants };
