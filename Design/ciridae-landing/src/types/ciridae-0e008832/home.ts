// Content types for the ciridae.com home page clone.
// Namespaced per site (ciridae-0e008832) / page (root-8a5edab2).

/** One "points" card (01/02/03 process steps). */
export interface PointsItem {
  /** e.g. "01" */
  index: string;
  title: string;
  description: string;
}

/** One we-do accordion column. */
export interface WeDoItem {
  index: string;
  title: string;
  description: string;
  image: string;
}

/** One testimonial slide. */
export interface Testimonial {
  quote: string;
  author: string;
  role: string;
  image?: string;
}

/** One security timeline entry. */
export interface SecurityTimelineItem {
  tag: string;
  title: string;
  description: string;
}

/** Nav link inside burger menu. */
export interface NavLink {
  label: string;
  href: string;
}

/** Client logo in team marquee (image path + alt). */
export interface ClientLogo {
  src: string;
  alt: string;
}
