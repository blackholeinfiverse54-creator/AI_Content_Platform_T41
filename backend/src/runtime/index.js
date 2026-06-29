/**
 * ARTHA Runtime Governance Infrastructure — v1.0
 *
 * Re-exports everything from the runtime governance modules:
 * - capabilityLoader: Dynamic contract loading and registry
 * - contractValidator: Contract schema and integrity validation
 * - authorityEngine: Authority enforcement engine
 * - serviceInterceptor: Service-level authority interception
 */

export {
  getCapabilityRegistry,
  getCapability,
  getAllCapabilities,
  getCapabilityForRoute,
  validateStartup,
  resetLoader,
} from './capability_loader/index.js';

export {
  validateAllContracts,
  validateContract,
} from './contract_validator/index.js';

export {
  authorityEnforcement,
  capabilityGuard,
  guardCollectionAccess,
  logAuthorityViolation,
  getAuthorityDefinition,
  listAllAuthorityBoundaries,
  verifyCapabilityIntegrity,
  enforceServiceAccess,
  enforceJobAccess,
  getOwnershipMap,
  getUnownedCollections,
  getCapabilityCollections,
  auditEnforcement,
} from './authority_runtime/index.js';

export {
  createServiceProxy,
  wrapAllServices,
  interceptCollectionAccess,
} from './enforcement_engine/index.js';
