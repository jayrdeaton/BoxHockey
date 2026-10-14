// Wraps useAudioPool with the app's own sound-enabled setting (Feedback.tsx/SettingsDialog) -
// for gameplay SFX (bounce, goal, faceoff, etc.) that play outside the button-press pipeline, which
// already gates its own `sound` callbacks on this same setting internally (see
// useFeedbackHandlers' `fire`). Was a hand-rolled wrapper, byte-for-byte identical to
// @rific/feedback-press/audio's own useGatedAudioPool - now a thin re-export under this app's own
// name.
export { useGatedAudioPool as useGameSound } from '@rific/feedback-press/audio'
