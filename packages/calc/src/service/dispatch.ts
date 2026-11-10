export interface TechnicianCandidate {
  id: string;
  employeeCode: string;
  name: string;
  skillLevel: number; // 1 to 5
  openJobs: number;
  maxJobs: number;
  isOnLeave?: boolean;
  territoryMatch: 'EXACT' | 'PARENT' | 'NONE';
}

export interface DispatchScoringResult {
  technicianId: string;
  employeeCode: string;
  name: string;
  score: number;
}

export function scoreAndSelectTechnician(
  candidates: TechnicianCandidate[],
  requiredSkillLevel = 1,
): DispatchScoringResult | null {
  const eligible = candidates.filter((c) => {
    if (c.isOnLeave) return false;
    if (c.skillLevel < requiredSkillLevel) return false;
    if (c.territoryMatch === 'NONE') return false;
    if (c.maxJobs <= 0 || c.openJobs >= c.maxJobs) return false;
    return true;
  });

  if (eligible.length === 0) {
    return null;
  }

  const scored = eligible.map((c) => {
    const skillPart = 0.5 * (Math.min(5, c.skillLevel) / 5);
    const loadRatio = Math.min(1, Math.max(0, c.openJobs / c.maxJobs));
    const workloadPart = 0.3 * (1 - loadRatio);
    const proximityPart = 0.2 * (c.territoryMatch === 'EXACT' ? 1.0 : 0.5);

    const score = Math.round((skillPart + workloadPart + proximityPart) * 10000) / 10000;

    return {
      technicianId: c.id,
      employeeCode: c.employeeCode,
      name: c.name,
      score,
      openJobs: c.openJobs,
    };
  });

  // Sort by score DESC, openJobs ASC, employeeCode ASC
  scored.sort((a, b) => {
    if (Math.abs(b.score - a.score) > 0.0001) {
      return b.score - a.score;
    }
    if (a.openJobs !== b.openJobs) {
      return a.openJobs - b.openJobs;
    }
    return a.employeeCode.localeCompare(b.employeeCode);
  });

  const best = scored[0]!;
  return {
    technicianId: best.technicianId,
    employeeCode: best.employeeCode,
    name: best.name,
    score: best.score,
  };
}

