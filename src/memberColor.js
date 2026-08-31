// Same four colors as GuidesView's category legend, reused here so each
// member's name in the chat reads as a distinct, theme-independent "player"
// rather than following whichever accent the active theme happens to use.
const MEMBER_COLORS = ['#4f8fe0', '#e0564f', '#3fb37f', '#e0559c']

export function memberColor(hubUserId) {
  return MEMBER_COLORS[Number(hubUserId) % MEMBER_COLORS.length]
}
