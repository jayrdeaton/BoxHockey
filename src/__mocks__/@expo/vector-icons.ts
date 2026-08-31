const Icon = ({ children }: any) => children || null

module.exports = {
  Ionicons: Icon,
  MaterialCommunityIcons: Icon,
  MaterialIcons: Icon,
  FontAwesome: Icon,
  default: { Ionicons: Icon }
}
