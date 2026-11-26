import type { SpaceVisibility } from "@/lib/permissions";
import { spaceVisibilityInfo } from "@/lib/space-visibility";
import { WikiIcon } from "./WikiIcon";
import styles from "./SpaceVisibilityField.module.css";

export function SpaceVisibilityField({ defaultValue, labelledBy }: { defaultValue: SpaceVisibility; labelledBy?: string }) {
  return (
    <fieldset className={styles.field} role="radiogroup" aria-labelledby={labelledBy ?? "visibility-legend"}>
      {!labelledBy && <legend id="visibility-legend" className="field-label">공개 범위</legend>}
      <div className={styles.options}>
        {(["organization", "restricted"] as const).map(value => {
          const { label, description, icon } = spaceVisibilityInfo[value];
          const id = `visibility-${value}`;
          return (
            <label key={value} className={styles.option}>
              <span className={styles.name} id={`${id}-label`}><WikiIcon name={icon} />{label}</span>
              <input type="radio" name="visibility" value={value} defaultChecked={value === defaultValue}
                aria-labelledby={`${id}-label`} aria-describedby={`${id}-description`} required />
              <span id={`${id}-description`} className={styles.description}>{description}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
