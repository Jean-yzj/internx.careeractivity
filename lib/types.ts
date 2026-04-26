export type ActivityType =
  | "講座"
  | "說明會"
  | "工作坊"
  | "博覽會"
  | "交流活動"
  | "競賽"
  | "企業參訪"
  | "校園大使"
  | "創業活動"
  | "其他";

export const ACTIVITY_TYPES: ActivityType[] = [
  "講座",
  "說明會",
  "工作坊",
  "博覽會",
  "交流活動",
  "競賽",
  "企業參訪",
  "校園大使",
  "創業活動",
  "其他",
];

export type SchoolKey = "nccu" | "ntu" | "ncku" | "nthu" | "nycu" | "ntnu" | "ncu" | "nsysu";

export interface SchoolMeta {
  key: SchoolKey;
  name: string;
  shortName: string;
  region: "北部" | "中部" | "南部" | "東部";
  homepageUrl: string;
}

export const SCHOOLS: Record<SchoolKey, SchoolMeta> = {
  nccu: {
    key: "nccu",
    name: "國立政治大學",
    shortName: "政大",
    region: "北部",
    homepageUrl: "https://moltke.nccu.edu.tw/",
  },
  ntu: {
    key: "ntu",
    name: "國立臺灣大學",
    shortName: "台大",
    region: "北部",
    homepageUrl: "https://career.ntu.edu.tw/",
  },
  ncku: {
    key: "ncku",
    name: "國立成功大學",
    shortName: "成大",
    region: "南部",
    homepageUrl: "https://cse.ncku.edu.tw/",
  },
  nthu: {
    key: "nthu",
    name: "國立清華大學",
    shortName: "清大",
    region: "北部",
    homepageUrl: "https://career.site.nthu.edu.tw/",
  },
  nycu: {
    key: "nycu",
    name: "國立陽明交通大學",
    shortName: "陽明交大",
    region: "北部",
    homepageUrl: "https://osa.nycu.edu.tw/",
  },
  ntnu: {
    key: "ntnu",
    name: "國立臺灣師範大學",
    shortName: "師大",
    region: "北部",
    homepageUrl: "https://careercenter.ntnu.edu.tw/",
  },
  ncu: {
    key: "ncu",
    name: "國立中央大學",
    shortName: "中央",
    region: "北部",
    homepageUrl: "https://careercenter.ncu.edu.tw/",
  },
  nsysu: {
    key: "nsysu",
    name: "國立中山大學",
    shortName: "中山",
    region: "南部",
    homepageUrl: "https://ag-osa.nsysu.edu.tw/",
  },
};

export interface Activity {
  /** 跨校唯一 ID(school + sourceExternalId) */
  id: string;
  /** 來源學校 */
  school: SchoolKey;
  /** 來源系統的活動 ID(用於組成 sourceUrl) */
  sourceExternalId: string;
  /** 報名/詳情頁外部連結 */
  sourceUrl: string;
  title: string;
  description: string;
  activityType: ActivityType;
  organizerName: string;
  /** ISO 字串(便於序列化傳到 client) */
  startDateTime: string;
  endDateTime: string;
  registrationDeadline: string | null;
  venueType: "physical" | "online" | "hybrid" | "unknown";
  venueAddress: string | null;
  feeType: "free" | "paid" | "unknown";
  feeAmount: number | null;
  contact: {
    email: string | null;
    phone: string | null;
    contactPersonName: string | null;
  };
  maxCapacity: number | null;
}
