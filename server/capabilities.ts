export type CreationMode = "omni" | "first_frame" | "first_last" | "edit" | "extend" | "text";

export type ModelCapability = {
  id: string;
  name: string;
  note: string;
  modes: CreationMode[];
  resolutions: string[];
  ratios: string[];
  duration: [number, number];
  imageLimit: number;
  videoLimit: number;
  audioLimit: number;
  audioOnly: boolean;
  supportsAudio: boolean;
  outputFormats: string[];
};

const ratios = ["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"];
const advanced: CreationMode[] = ["omni", "first_frame", "first_last", "edit", "extend", "text"];

export const MODELS: ModelCapability[] = [
  { id: "dreamina-seedance-2-5-260628", name: "Seedance 2.5", note: "最高质量 · 30 秒叙事", modes: advanced, resolutions: ["480p", "720p", "1080p"], ratios, duration: [4, 30], imageLimit: 30, videoLimit: 10, audioLimit: 10, audioOnly: true, supportsAudio: true, outputFormats: ["mp4", "mov"] },
  { id: "dreamina-seedance-2-0-260128", name: "Seedance 2.0", note: "旗舰质量 · 支持 4K", modes: advanced, resolutions: ["480p", "720p", "1080p", "4k"], ratios, duration: [4, 15], imageLimit: 9, videoLimit: 3, audioLimit: 3, audioOnly: false, supportsAudio: true, outputFormats: ["mp4"] },
  { id: "dreamina-seedance-2-0-fast-260128", name: "Seedance 2.0 Fast", note: "速度与质量平衡", modes: advanced, resolutions: ["480p", "720p"], ratios, duration: [4, 15], imageLimit: 9, videoLimit: 3, audioLimit: 3, audioOnly: false, supportsAudio: true, outputFormats: ["mp4"] },
  { id: "dreamina-seedance-2-0-mini-260615", name: "Seedance 2.0 Mini", note: "高性价比 · 快速出片", modes: advanced, resolutions: ["480p", "720p"], ratios, duration: [4, 15], imageLimit: 9, videoLimit: 3, audioLimit: 3, audioOnly: false, supportsAudio: true, outputFormats: ["mp4"] },
  { id: "seedance-1-5-pro-251215", name: "Seedance 1.5 Pro", note: "稳定的基础生成", modes: ["first_frame", "first_last", "text"], resolutions: ["480p", "720p", "1080p"], ratios, duration: [4, 12], imageLimit: 2, videoLimit: 0, audioLimit: 0, audioOnly: false, supportsAudio: true, outputFormats: ["mp4"] },
  { id: "seedance-1-0-pro-250528", name: "Seedance 1.0 Pro", note: "经典专业模型", modes: ["first_frame", "first_last", "text"], resolutions: ["480p", "720p", "1080p"], ratios, duration: [2, 12], imageLimit: 2, videoLimit: 0, audioLimit: 0, audioOnly: false, supportsAudio: false, outputFormats: ["mp4"] },
  { id: "seedance-1-0-pro-fast-251015", name: "Seedance 1.0 Pro Fast", note: "经典快速模型", modes: ["first_frame", "text"], resolutions: ["480p", "720p", "1080p"], ratios, duration: [2, 12], imageLimit: 1, videoLimit: 0, audioLimit: 0, audioOnly: false, supportsAudio: false, outputFormats: ["mp4"] }
];

export const getModel = (id: string) => MODELS.find((model) => model.id === id);
