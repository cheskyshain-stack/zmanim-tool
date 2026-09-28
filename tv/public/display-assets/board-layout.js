import {fitBoardSchedules} from './board-schedules.js';
import {fitBottomNotices} from './bottom-notices.js';
import {fitOriginalSheet} from './original-sheet.js';

// One bottom edge and one top edge on every date. A full-height chart may
// claim horizontal space beside the notices, never move the notices upward.
export const NOTICE_BAND_HEIGHT = 320;

export function layoutFixedBoard(view, groups, sheet) {
  const {stage,notices,schedules}=view;
  stage.classList.remove('right-extended','left-extended','special-expanded','week-extended','week-wide-notices','sheet-wide-notices','compact-notice-spacing','compact-zmanim-spacing');
  for (const property of ['--week-notice-rail','--board-special-width']) stage.style.removeProperty(property);
  stage.classList.toggle('all-notices',!!groups.length);
  stage.classList.toggle('without-notices',!groups.length);
  stage.classList.toggle('sheet-notices',!!sheet);
  stage.style.setProperty('--notice-height',NOTICE_BAND_HEIGHT+'px');
  view.noticePages=groups.length?[groups]:[];
  view.noticePage=0;
  view.renderNotices();

  const rows=sheet?.sections?.reduce((sum,section)=>sum+(section.rows?.length||0),0)||0;
  const target=sheet?Math.max(740,Math.min(940,680+rows*3)):680;
  const widths=sheet?[700,760,820,880,940]:[520,580,640,700,760,820,880];
  let best;
  for (const width of widths) {
    stage.style.setProperty('--board-special-width',width+'px');
    stage.classList.toggle('right-extended',!!sheet);
    let fit=fitBoardSchedules(schedules,view.snapshot.schedule.presentation,{allowCompact:false});
    const extended=!!sheet||!!fit.special?.overflow;
    stage.classList.toggle('right-extended',extended);
    fit=fitBoardSchedules(schedules,view.snapshot.schedule.presentation,{allowCompact:true});
    const noticeFit=fitBottomNotices(notices,groups);
    const overflow=(fit.weekly?.overflow||0)+(fit.special?.overflow||0)+noticeFit.overflow;
    // Schedule integrity wins. Then retain readable announcement type while
    // giving the actual chart a proportionate share of the screen's width.
    const score=overflow*10000+(18-noticeFit.fontSize)*45+Math.abs(width-target)*.2;
    if(!best||score<best.score)best={width,extended,score};
  }
  stage.style.setProperty('--board-special-width',best.width+'px');
  stage.classList.toggle('right-extended',best.extended);
  fitBoardSchedules(schedules,view.snapshot.schedule.presentation,{allowCompact:true});
  view.noticeFit=fitBottomNotices(notices,groups);
  if(view.zmanim.scrollHeight>view.zmanim.clientHeight+2)stage.classList.add('compact-zmanim-spacing');
  if(view.originalSheetBox)fitOriginalSheet(view.originalSheetBox);
}
