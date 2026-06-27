// Helper para obtener iconos de Lucide según su nombre

const iconMap = {
  'signal-slash': '📶',
  'chart-no-axes-combined': '📊',
  'hard-drive': '💾',
  'coins': '💱',
  'users': '👥',
  'clock': '⏱️',
  'shopping-cart': '🛒',
  'wallet': '💼',
  'box': '📦',
  'users-cog': '👨‍💼',
  'cloud-sync': '☁️',
  'file-chart-column': '📈',
};

export function getIconComponent(iconName) {
  return iconMap[iconName] || '•';
}
