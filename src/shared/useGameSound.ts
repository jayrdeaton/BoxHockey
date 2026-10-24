// Gameplay sounds (bounce, goal, face-off and the like) that play outside the button-press pipeline,
// gated on the player's Sound setting: @rific/feedback-press/audio's useGatedAudioPool, under the
// name every game's play screen uses. Call once per distinct clip.
export { useGatedAudioPool as useGameSound } from '@rific/feedback-press/audio'
