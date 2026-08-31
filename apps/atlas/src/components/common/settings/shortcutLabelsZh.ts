import type { ShortcutActionId, ShortcutCategory } from '../../../services/shortcutTypes';

export const SHORTCUT_CATEGORY_ZH: Record<ShortcutCategory, string> = {
  Playback: '播放', Navigation: '导航', Editing: '编辑', Tools: '工具', Panels: '面板',
  Preview: '预览', Project: '项目', History: '历史', Masking: '蒙版',
};

export const SHORTCUT_LABEL_ZH: Partial<Record<ShortcutActionId, string>> = {
  'playback.playPause': '播放 / 暂停', 'playback.pause': '暂停', 'playback.playForward': '正向播放',
  'playback.playReverse': '反向播放', 'playback.toggleLoop': '切换循环播放', 'nav.frameForward': '前进一帧',
  'nav.frameBackward': '后退一帧', 'edit.setIn': '设置入点', 'edit.setOut': '设置出点',
  'edit.clearInOut': '清除入点 / 出点', 'edit.addMarker': '添加标记', 'edit.splitAtPlayhead': '在播放头处分割',
  'edit.delete': '删除', 'edit.copy': '复制', 'edit.paste': '粘贴', 'edit.blendModeNext': '下一个混合模式',
  'edit.blendModePrev': '上一个混合模式', 'tool.select': '选择工具', 'tool.selectionGroup': '切换选择工具',
  'tool.trackSelectForward': '向前选择轨道', 'tool.trackSelectBackward': '向后选择轨道',
  'tool.trackSelectForwardAll': '向前选择全部轨道', 'tool.rangeSelect': '范围选择工具',
  'tool.cutToggle': '切割 / 剃刀工具', 'tool.blade': '刀片工具', 'tool.bladeAllTracks': '切割全部轨道',
  'tool.glue': '合并工具', 'tool.trimGroup': '切换修剪工具', 'tool.edgeTrim': '普通边缘修剪',
  'tool.rippleTrim': '波纹修剪', 'tool.rollingEdit': '滚动编辑', 'tool.slip': '滑移工具',
  'tool.slide': '滑动工具', 'tool.rateStretch': '速率拉伸', 'tool.placementGroup': '切换放置工具',
  'tool.positionOverwrite': '位置 / 覆盖移动', 'tool.navigationGroup': '切换导航工具', 'tool.hand': '抓手 / 平移工具',
  'tool.zoom': '缩放工具', 'tool.penKeyframe': '钢笔 / 关键帧工具', 'tool.midiDraw': 'MIDI 铅笔工具',
  'edit.splitAllAtPlayhead': '在播放头处分割全部轨道', 'edit.trimStartToPlayhead': '修剪开头到播放头',
  'edit.trimEndToPlayhead': '修剪结尾到播放头', 'edit.rippleTrimStartToPlayhead': '波纹修剪开头到播放头',
  'edit.rippleTrimEndToPlayhead': '波纹修剪结尾到播放头', 'edit.rippleDelete': '波纹删除',
  'edit.deleteGap': '删除间隙', 'edit.liftRange': '提升范围', 'edit.extractRange': '提取范围',
  'edit.insertSource': '插入源素材', 'edit.overwriteSource': '覆盖源素材', 'edit.replaceSource': '替换为源素材',
  'edit.fitToFillSource': '适配源素材以填满', 'edit.appendSourceAtEnd': '追加到时间线末尾',
  'edit.placeSourceOnTop': '放置到上层', 'edit.rippleOverwriteSource': '波纹覆盖源素材',
  'project.new': '新建项目', 'project.open': '打开项目', 'project.save': '保存', 'project.saveAs': '另存为',
  'history.undo': '撤销', 'history.redo': '重做', 'panel.toggleHoveredFullscreen': '当前面板全屏',
  'view.toggleCurveMode': '切换时间线 / 曲线视图', 'preview.editMode': '切换编辑模式',
  'preview.slot1': '预览槽位 1', 'preview.slot2': '预览槽位 2', 'preview.slot3': '预览槽位 3', 'preview.slot4': '预览槽位 4',
  'mask.pen': '钢笔蒙版工具', 'mask.edit': '编辑蒙版路径', 'mask.rectangle': '矩形蒙版工具',
  'mask.ellipse': '椭圆蒙版工具', 'mask.closePath': '闭合蒙版路径', 'mask.invert': '反转当前蒙版',
  'mask.toggleOutline': '显示 / 隐藏蒙版轮廓', 'mask.selectAllVertices': '选择全部蒙版顶点',
  'mask.toggleVertexHandles': '显示 / 隐藏所选顶点手柄',
};
