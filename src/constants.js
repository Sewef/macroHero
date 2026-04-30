/**
 * Global Constants - Centralized configuration
 */

/**
 * Integration names used for expression evaluation and async detection
 * Used by ExecutionSandbox, VariableEngine, and configModal debug mode
 */
export const ASYNC_INTEGRATION_NAMES = [
  'GoogleSheets', 'OwlTrackers', 'ConditionMarkers', 'StatBubbles',
  'ColoredRings', 'PrettySordid', 'Local', 'Embers', 'JustDices', 'Weather',
  'Aurora', 'Announcement', 'Auras', 'Owlbear', 'Token', 'Scene'
];

export default {
  ASYNC_INTEGRATION_NAMES,
};
