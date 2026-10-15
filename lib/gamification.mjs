export const SAGE_LEVELS = [
  { name:'Pilgrim', points:0 },
  { name:'Acolyte', points:25 },
  { name:'Scholar', points:100 },
  { name:'Sage', points:300 },
  { name:'Elder', points:750 },
  { name:'Oracle', points:1500 }
];

export function progression(points=0) {
  const score=Math.max(0,Number(points)||0);
  let index=SAGE_LEVELS.length-1;
  while(index>0&&score<SAGE_LEVELS[index].points) index--;
  const current=SAGE_LEVELS[index],next=SAGE_LEVELS[index+1]||null;
  return {level:current.name,levelIndex:index,nextLevel:next?.name||null,nextAt:next?.points||null,progress:next?Math.min(100,Math.round((score-current.points)/(next.points-current.points)*100)):100,pointsToNext:next?Math.max(0,next.points-score):0};
}

function isoWeekStart(date=new Date()) {
  const utc=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate()));
  const day=utc.getUTCDay()||7;
  utc.setUTCDate(utc.getUTCDate()-day+1);
  return utc.toISOString().slice(0,10);
}

function similarity(left,right) {
  const words=value=>String(value||'').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').match(/[a-z0-9]+/g)||[];
  const a=words(left),b=words(right);
  if(!a.length||!b.length)return 0;
  const counts=list=>list.reduce((map,word)=>map.set(word,(map.get(word)||0)+1),new Map());
  const ac=counts(a),bc=counts(b),keys=new Set([...ac.keys(),...bc.keys()]);
  let dot=0,aa=0,bb=0;
  for(const key of keys){const x=ac.get(key)||0,y=bc.get(key)||0;dot+=x*y;aa+=x*x;bb+=y*y}
  return dot/Math.sqrt(aa*bb);
}

export function createGamification(db) {
  const event=db.prepare('INSERT INTO wisdom_events(user_id,kind,points,note,actor_id,reference_id,impact_minutes) VALUES(?,?,?,?,?,?,?)');
  const count=db.prepare('SELECT COUNT(*) n FROM wisdom_events WHERE user_id=? AND kind=? AND date(created_at)>=?');
  const weekStart=()=>isoWeekStart();
  const insert=(userId,kind,points,note,actorId=userId,referenceId=null,impactMinutes=0)=>{
    if(points<=0&&!impactMinutes)return {points:0};
    const result=event.run(userId,kind,points,note,actorId,referenceId,impactMinutes);
    return {points,id:Number(result.lastInsertRowid)};
  };
  return {
    progression,
    rewardOffering(userId,title,description) {
      const candidates=db.prepare('SELECT title,body FROM contributions').all();
      if(candidates.some(item=>similarity(`${title} ${description}`,`${item.title} ${item.body}`)>0.9))return {points:0,reason:'duplicate'};
      if(count.get(userId,'shared',weekStart()).n>=3)return {points:0,reason:'weekly_cap'};
      return insert(userId,'shared',10,`Shared ${title}`);
    },
    rewardSeek(userId,requestId) {
      if(count.get(userId,'sought',weekStart()).n>=3)return {points:0,reason:'weekly_cap'};
      return insert(userId,'sought',2,'Asked PYTHIA for help',userId,requestId);
    },
    rewardSolutionUse(solutionId,ownerId,actorId,minutesSaved=0,runId=null) {
      if(Number(ownerId)===Number(actorId))return {points:0,reason:'own_solution'};
      const monthly=db.prepare("SELECT COUNT(*) n FROM wisdom_events WHERE kind='solution_used' AND user_id=? AND actor_id=? AND reference_id=? AND strftime('%Y-%m',created_at)=strftime('%Y-%m','now')").get(ownerId,actorId,solutionId).n;
      if(monthly)return {points:0,reason:'already_used_this_month'};
      const first=db.prepare("SELECT COUNT(*) n FROM wisdom_events WHERE kind='solution_used' AND reference_id=?").get(solutionId).n===0;
      const base=insert(ownerId,'solution_used',5,'Solution used by a colleague',actorId,solutionId,Math.min(240,Math.max(0,Number(minutesSaved)||0)));
      const bonus=first?insert(ownerId,'first_use',10,'First use by another colleague',actorId,solutionId):{points:0};
      return {points:base.points+bonus.points,firstUse:first};
    },
    rewardHelp(ownerId,actorId,runId) {
      const prior=db.prepare("SELECT id FROM wisdom_events WHERE kind='helped' AND reference_id=? LIMIT 1").get(runId);
      if(prior)return {points:0,reason:'already_counted'};
      return insert(ownerId,'helped',20,'A colleague confirmed this helped',actorId,runId);
    },
    rewardThanks(actorId,targetId,note='') {
      if(Number(actorId)===Number(targetId))return {points:0,reason:'self_thanks'};
      const recent=db.prepare("SELECT COUNT(*) n FROM wisdom_events WHERE kind IN ('thanks_given','thanked') AND date(created_at)>=? AND ((user_id=? AND reference_id=?) OR (user_id=? AND reference_id=?))").get(weekStart(),actorId,targetId,targetId,actorId).n;
      if(recent)return {points:0,reason:'pair_weekly_cap'};
      const given=count.get(actorId,'thanks_given',weekStart()).n;
      if(given>=5)return {points:0,reason:'weekly_cap'};
      const text=String(note||'').trim().slice(0,180);
      insert(actorId,'thanks_given',1,text||'Thanked a colleague',actorId,targetId);
      const received=insert(targetId,'thanked',5,text||'Received thanks from a colleague',actorId,actorId);
      return {points:received.points+1};
    },
    rewardSkillConfirmation(userId,skill) {
      const prior=db.prepare("SELECT id FROM wisdom_events WHERE user_id=? AND kind='skill_confirmed' AND lower(note)=lower(?) LIMIT 1").get(userId,skill);
      if(prior)return {points:0,reason:'already_confirmed'};
      return insert(userId,'skill_confirmed',1,skill,userId,null);
    }
  };
}
